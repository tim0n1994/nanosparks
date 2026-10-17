/**
 * Pipeline Watchdog — lightweight in-process health guard.
 *
 * Runs inside the worker process (no extra process/部署步骤). Every few
 * minutes it checks for "stuck" conversations and requeues them. This is NOT
 * monitoring/alerting — it's a minimal self-healing mechanism to keep the
 * transcription pipeline flowing when jobs silently fail (ASR crash, BullMQ
 * stalled job, DB status not rolled back on error).
 *
 * Queue ownership is checked per conversation. Missing queue evidence is not
 * evidence of an idle worker, and partial extraction is never called complete.
 */

import { prisma } from '@/lib/prisma';
import { transcribeQueue, analyzeQueue } from '@/lib/queue/config';
import type { Job, Queue } from 'bullmq';
import { logger } from '@/lib/logger';
import { join } from 'node:path';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 min
const STUCK_MINUTES = 10; // transcribing > 10 min with no ASR activity = stuck

interface WatchdogResult {
  checked: number;
  requeued: number;
  reset: number;
}

async function queueSnapshot(queue: Queue): Promise<{ live: Job[]; failed: Job[] } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = Promise.all([
      queue.getJobs(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']),
      queue.getJobs(['failed']),
    ]);
    const [live, failed] = await Promise.race([
      snapshot,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queue state check timed out')), 5000);
      }),
    ]);
    return { live, failed };
  } catch (error) {
    logger.warn('watchdog: queue state unavailable; preserving conversation state', { error: String(error) });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Candidate {
  id: string;
  episodeId: string | null;
  updatedAt: Date;
  _count: { turns: number; participants: number };
}

function belongsTo(job: Job, conversation: Candidate): boolean {
  return job.data.conversationId === conversation.id
    || (!!conversation.episodeId && job.data.episodeId === conversation.episodeId);
}

/** Find audio file for a conversation on disk. */
async function findAudioPath(conversationId: string): Promise<string | null> {
  const { existsSync } = await import('node:fs');
  const audioDirectory = getAudioOutputDir();
  const exts = ['m4a', 'mp3', 'wav', 'webm'];
  // 1. conversationId-named files (legacy / watchdog-requeued).
  for (const ext of exts) {
    const p = join(audioDirectory, `${conversationId}.${ext}`);
    if (existsSync(p)) return p;
  }
  // 2. videoId-named files: the yt-dlp download path uses the YouTube videoId,
  //    not the conversationId. Resolve via episodeKey (youtube:<videoId>).
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { episodeKey: true },
  });
  const videoId = conv?.episodeKey?.replace(/^youtube:/, '');
  if (videoId) {
    for (const ext of exts) {
      const p = join(audioDirectory, `${videoId}.${ext}`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Single watchdog tick. Returns what it did. Pure side-effecting logic —
 * safe to call directly in tests with a mocked prisma + queue.
 */
async function runTick(): Promise<WatchdogResult> {
  const result: WatchdogResult = { checked: 0, requeued: 0, reset: 0 };

  const threshold = new Date(Date.now() - STUCK_MINUTES * 60 * 1000);
  for (const [status, queue] of [['transcribing', transcribeQueue], ['analyzing', analyzeQueue]] as const) {
    const candidates = await prisma.conversation.findMany({
      where: { status, updatedAt: { lt: threshold } },
      select: { id: true, episodeId: true, updatedAt: true, _count: { select: { turns: true, participants: true } } },
    });
    result.checked += candidates.length;
    if (candidates.length === 0) continue;
    const snapshot = await queueSnapshot(queue);
    if (!snapshot) continue;

    for (const conv of candidates) {
      if (snapshot.live.some((job) => belongsTo(job, conv))) continue;
      const exhausted = snapshot.failed.some((job) => belongsTo(job, conv)
        && (job.finishedOn ?? 0) >= conv.updatedAt.getTime());
      const hasOutput = conv._count.turns > 0 || conv._count.participants > 0;
      const audioPath = status === 'transcribing' && !exhausted && !hasOutput
        ? await findAudioPath(conv.id) : null;

      if (!audioPath) {
        // Do not replay non-idempotent writes over partial output. A guarded
        // failure makes retry explicit while preserving every existing row.
        const updated = await prisma.conversation.updateMany({
          where: { id: conv.id, status, updatedAt: conv.updatedAt },
          data: { status: 'failed' },
        });
        result.reset += updated.count;
        logger.warn('watchdog: orphaned pipeline needs retry', { conversationId: conv.id, status, exhausted, hasOutput });
        continue;
      }

      try {
        await transcribeQueue.add('transcribe', {
          conversationId: conv.id,
          audioPath,
          mimeType: audioPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/m4a',
        }, { jobId: `watchdog-${conv.id}-${conv.updatedAt.getTime()}` });
        result.requeued++;
        // Leave the status unchanged until the worker takes ownership. Failed
        // enqueue therefore remains eligible for the next watchdog tick.
        logger.info('watchdog: requeued', { conversationId: conv.id });
      } catch (error) {
        logger.error('watchdog: requeue failed', { conversationId: conv.id, error: String(error) });
      }
    }
  }

  return result;
}

let activeTick: Promise<WatchdogResult> | null = null;

export function watchdogTick(): Promise<WatchdogResult> {
  if (!activeTick) {
    activeTick = runTick().finally(() => { activeTick = null; });
  }
  return activeTick;
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
