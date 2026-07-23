/**
 * Batch Ingest Orchestrator (PRD: 粘贴播客源 → 批量处理选中集).
 *
 * Reuses the same primitives as the digest worker: per-episode
 * findOrLinkGlobalEpisode (dedupe + cache) → addIngestJob. Enforces monthly
 * quota (Free 4 / Pro 60) by local decrement so the batch can't overspend.
 * Cache hits are free and skipped. Concurrent/daily guardrails are NOT applied
 * at enqueue time — the worker's transcribe concurrency=1 serializes the batch.
 *
 * The per-episode cost circuit breaker (¥3) still fires in the analyze step.
 */

import type { ResolvedEpisode } from '@/lib/resolvers/types';
import { parseEpisodeKey } from '@/lib/resolvers/episode-key';
import { findOrLinkGlobalEpisode } from '@/lib/resolvers/cache';
import { addIngestJob } from '@/lib/queue/config';
import { getMonthlyQuotaStatus } from '@/lib/quota';
import { getUserTier, monthlyQuotaFor } from '@/lib/billing/tier';
import { logger } from '@/lib/logger';

export interface BatchEpisodeInput {
  episodeKey: string;
  audioUrl: string;
  sourceUrl: string;
  platform: string;
  title: string;
  durationSec?: number;
}

export interface BatchEpisodeResult {
  conversationId: string;
  title: string;
  cached: boolean;
}

export interface BatchIngestResult {
  /** Episodes enqueued for processing (cache misses within quota). */
  enqueued: BatchEpisodeResult[];
  /** Episodes already in the shared cache — free reads, included in enqueued. */
  cachedResults: BatchEpisodeResult[];
  /** Episodes skipped because monthly quota was exhausted. */
  skippedQuota: number;
  quotaUsed: number;
  quotaLimit: number;
}

/** Build a ResolvedEpisode from the client-supplied episode fields. */
function toResolvedEpisode(ep: BatchEpisodeInput): ResolvedEpisode | null {
  const parsed = parseEpisodeKey(ep.episodeKey);
  if (!parsed) return null;
  return {
    platform: parsed.platform,
    platformId: parsed.platformId,
    episodeKey: ep.episodeKey,
    title: ep.title,
    audioUrl: ep.audioUrl,
    sourceUrl: ep.sourceUrl,
    durationSec: ep.durationSec,
    isMultiEpisode: false,
  };
}

export async function batchIngestEpisodes(args: {
  userId: string;
  episodes: BatchEpisodeInput[];
  mode: string;
}): Promise<BatchIngestResult> {
  const { userId, episodes, mode } = args;

  const tier = await getUserTier(userId);
  const quotaLimit = monthlyQuotaFor(tier);
  const quota = await getMonthlyQuotaStatus(userId, { freeMonthlyFirstTranscriptions: quotaLimit });
  let remaining = quota.remaining;

  const enqueued: BatchEpisodeResult[] = [];
  const cachedResults: BatchEpisodeResult[] = [];
  let skippedQuota = 0;
  let quotaUsed = 0;

  for (const ep of episodes) {
    const resolved = toResolvedEpisode(ep);
    if (!resolved) {
      logger.warn('batch ingest: unparseable episodeKey, skipping', { episodeKey: ep.episodeKey });
      continue;
    }

    const { conversationId, cached } = await findOrLinkGlobalEpisode(resolved, userId);

    if (cached) {
      // Cache hits are free — always included, never consume quota.
      cachedResults.push({ conversationId, title: ep.title, cached: true });
      enqueued.push({ conversationId, title: ep.title, cached: true });
      continue;
    }

    // Cache miss → consume one quota unit. Skip if exhausted.
    if (remaining <= 0) {
      skippedQuota++;
      continue;
    }

    await addIngestJob(
      {
        conversationId,
        episodeKey: ep.episodeKey,
        audioUrl: ep.audioUrl,
        sourceUrl: ep.sourceUrl,
        platform: ep.platform,
        title: ep.title,
        mode,
      },
    );
    remaining--;
    quotaUsed++;
    enqueued.push({ conversationId, title: ep.title, cached: false });
  }
  logger.info('batch ingest complete', {
    userId,
    total: episodes.length,
    enqueued: enqueued.length,
    cached: cachedResults.length,
    skippedQuota,
    quotaUsed,
    quotaLimit,
  });

  return { enqueued, cachedResults, skippedQuota, quotaUsed, quotaLimit };
}
