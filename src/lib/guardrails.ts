/**
 * Production guardrails (A4) — PRD §A4 护栏.
 *
 * Enforces the hard limits that protect cost + stability on a single VPS:
 *   - per-user concurrent processing cap (default 1)
 *   - per-user daily ingest cap (default 5)
 *   - audio duration ceiling (default 4h)
 *   - per-episode cost circuit breaker (default ¥3)
 *
 * Limits are read from Settings/env so they can be tuned without a redeploy.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface GuardrailConfig {
  maxConcurrentPerUser: number;
  maxDailyPerUser: number;
  maxAudioDurationSec: number;
  costCircuitBreakerCny: number;
}

const DEFAULTS: GuardrailConfig = {
  maxConcurrentPerUser: Number(process.env.GUARD_MAX_CONCURRENT ?? 1),
  maxDailyPerUser: Number(process.env.GUARD_MAX_DAILY ?? 5),
  maxAudioDurationSec: Number(process.env.GUARD_MAX_DURATION_SEC ?? 4 * 3600),
  costCircuitBreakerCny: Number(process.env.GUARD_COST_BREAKER_CNY ?? 3),
};

/** Load guardrail config, allowing Setting overrides at runtime. */
export async function loadGuardrailConfig(): Promise<GuardrailConfig> {
  const cfg = { ...DEFAULTS };
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: 'guardrail.' } },
    });
    for (const r of rows) {
      const val = parseFloat(r.value);
      if (Number.isNaN(val)) continue;
      if (r.key === 'guardrail.max_concurrent') cfg.maxConcurrentPerUser = val;
      if (r.key === 'guardrail.max_daily') cfg.maxDailyPerUser = val;
      if (r.key === 'guardrail.max_duration_sec') cfg.maxAudioDurationSec = val;
      if (r.key === 'guardrail.cost_breaker_cny') cfg.costCircuitBreakerCny = val;
    }
  } catch (err) {
    logger.warn('guardrail config load failed, using defaults', { error: String(err) });
  }
  return cfg;
}

export type GuardrailResult =
  | { ok: true }
  | { ok: false; reason: 'concurrent' | 'daily' | 'duration'; message: string };

/**
 * Check the pre-pipeline guardrails for a user submitting an episode.
 * Returns ok:false with a human message when a limit is hit.
 */
export async function checkIngestGuardrails(
  userId: string,
  opts: { durationSec?: number },
  cfg: GuardrailConfig = DEFAULTS,
): Promise<GuardrailResult> {
  // 1. Duration ceiling (independent of user).
  if (opts.durationSec && opts.durationSec > cfg.maxAudioDurationSec) {
    return {
      ok: false,
      reason: 'duration',
      message: `音频时长 ${Math.round(opts.durationSec / 60)} 分钟超过上限（${Math.round(cfg.maxAudioDurationSec / 60)} 分钟），暂不支持。`,
    };
  }

  // 2. Concurrent in-flight conversations for this user.
  // Count conversations in the user's corpora that are still processing.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const inFlight = await prisma.conversation.count({
    where: {
      status: { in: ['pending', 'processing', 'transcribing'] },
      updatedAt: { gte: oneDayAgo },
      source: { corpus: { workspace: { clerkId: userId } } },
    },
  });
  if (inFlight >= cfg.maxConcurrentPerUser) {
    return {
      ok: false,
      reason: 'concurrent',
      message: `你已有 ${inFlight} 个正在处理的任务，请等其完成后再提交（同时最多 ${cfg.maxConcurrentPerUser} 个）。`,
    };
  }

  // 3. Daily ingest count for this user.
  const dailyCount = await prisma.conversation.count({
    where: {
      createdAt: { gte: oneDayAgo },
      source: { corpus: { workspace: { clerkId: userId } } },
    },
  });
  if (dailyCount >= cfg.maxDailyPerUser) {
    return {
      ok: false,
      reason: 'daily',
      message: `今日已提交 ${dailyCount} 集，达到每日上限（${cfg.maxDailyPerUser} 集），请明天再试。`,
    };
  }

  return { ok: true };
}

/**
 * Cost circuit breaker (PRD §A4: 单集成本熔断 ¥3).
 * Called after an ExtractionRun to stop further work if a single episode blew
 * past the budget. Returns true if the breaker tripped.
 */
export function costBreakerTripped(costUsd: number, cfg: GuardrailConfig = DEFAULTS): boolean {
  // 1 USD ≈ 7.2 CNY (rough; the value is the CNY budget).
  const cny = costUsd * 7.2;
  if (cny > cfg.costCircuitBreakerCny) {
    logger.warn('cost circuit breaker tripped', { costUsd, cny, limit: cfg.costCircuitBreakerCny });
    return true;
  }
  return false;
}
