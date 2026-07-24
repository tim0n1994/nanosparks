/**
 * Pipeline Watchdog — lightweight in-process health guard.
 *
 * Runs inside the worker process (no extra process/部署步骤). Every few
 * minutes it checks for "stuck" conversations and requeues them. This is NOT
 * monitoring/alerting — it's a minimal self-healing mechanism to keep the
 * transcription pipeline flowing when jobs silently fail (ASR crash, BullMQ
 * stalled job, DB status not rolled back on error).
 *
 * Performance: one DB count query + one HTTP health ping per cycle. Only
 * acts (write/requeue) when it detects a real problem. Cost is negligible.
 */

import { prisma } from '@/lib/prisma';
import { transcribeQueue } from '@/lib/queue/config';
import { logger } from '@/lib/logger';

const ASR_URL = process.env.QWEN_ASR_URL || 'http://127.0.0.1:4319';
const ASR_KEY = process.env.QWEN_ASR_KEY || 'nsp-local';
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 min
const STUCK_MINUTES = 10; // transcribing > 10 min with no ASR activity = stuck

interface WatchdogResult {
  checked: number;
  requeued: number;
  reset: number;
}

/** Check ASR health — returns processing job count, or -1 if unreachable. */
async function asrProcessingCount(): Promise<number> {
  try {
    const resp = await fetch(`${ASR_URL}/health`, {
      headers: { Authorization: `Bearer ${ASR_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return -1;
    const data = (await resp.json()) as { status?: string; processing_jobs?: number };
    return data.status === 'ok' ? (data.processing_jobs ?? 0) : -1;
  } catch {
    return -1;
  }
}

/** Find audio file for a conversation on disk. */
async function findAudioPath(conversationId: string): Promise<string | null> {
  const { existsSync } = await import('node:fs');
  const exts = ['m4a', 'mp3', 'wav', 'webm'];
  for (const ext of exts) {
    const p = `/tmp/nanosparks-audio/${conversationId}.${ext}`;
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Single watchdog tick. Returns what it did. Pure side-effecting logic —
 * safe to call directly in tests with a mocked prisma + queue.
 */
export async function watchdogTick(): Promise<WatchdogResult> {
  const result: WatchdogResult = { checked: 0, requeued: 0, reset: 0 };

  // Find conversations stuck in 'transcribing' longer than the threshold.
  const threshold = new Date(Date.now() - STUCK_MINUTES * 60 * 1000);
  const stuck = await prisma.conversation.findMany({
    where: { status: 'transcribing', updatedAt: { lt: threshold } },
    select: { id: true },
  });
  result.checked = stuck.length;

  if (stuck.length === 0) return result;

  // Don't interrupt if ASR is actively processing (could be a legit long file).
  const asrProc = await asrProcessingCount();
  if (asrProc > 0) {
    logger.info('watchdog: stuck conversations found but ASR is busy, waiting', {
      stuck: stuck.length, asrProcessing: asrProc,
    });
    return result;
  }

  // ASR is idle → the stuck conversations are genuinely stuck. Reset + requeue.
  logger.warn('watchdog: recovering stuck conversations', { count: stuck.length });

  for (const conv of stuck) {
    const audioPath = await findAudioPath(conv.id);
    if (!audioPath) {
      // No audio file — can't requeue, just reset so it doesn't loop forever.
      await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'failed' } });
      result.reset++;
      logger.warn('watchdog: no audio found, marking failed', { conversationId: conv.id });
      continue;
    }

    await prisma.conversation.update({ where: { id: conv.id }, data: { status: 'pending' } });

    try {
      await transcribeQueue.add('transcribe', {
        conversationId: conv.id,
        audioPath,
        mimeType: audioPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/m4a',
      });
      result.requeued++;
      logger.info('watchdog: requeued', { conversationId: conv.id, audioPath });
    } catch (err) {
      // Requeue failed — reset to pending so the next tick can try again.
      logger.error('watchdog: requeue failed', { conversationId: conv.id, error: String(err) });
    }
  }

  return result;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start the watchdog inside the current process. Idempotent. */
export function startWatchdog(intervalMs: number = CHECK_INTERVAL_MS): void {
  if (intervalId) return;
  // Stagger the first check so it doesn't collide with worker boot.
  intervalId = setInterval(async () => {
    try {
      await watchdogTick();
    } catch (err) {
      // Never let the watchdog crash the worker process.
      logger.error('watchdog: tick failed', { error: String(err) });
    }
  }, intervalMs);
  logger.info('Pipeline watchdog started', { intervalMs });
}

/** Stop the watchdog (for tests / graceful shutdown). */
export function stopWatchdog(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
