import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, redisConnection } from '@/lib/redis';
import { Queue } from 'bullmq';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health/deep — dependency checks.
 *
 * 2026-10-20: moved verbatim from /api/health so the liveness probe could
 * stay cheap. Same judgment as before: SELECT 1 for the DB, redis ping,
 * BullMQ counts for ingest/transcribe/analyze when Redis is healthy, and
 * the ok/degraded verdict `checks.db && checks.redis`. One deliberate
 * change: a degraded verdict is now HTTP 503 instead of 200 — the old
 * always-200 made dependency failures invisible to status-based gates.
 */
export async function GET() {
  const checks = {
    db: false,
    redis: false,
    workerQueues: null as Record<string, { waiting: number; active: number; completed: number; failed: number }> | null,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    checks.redis = false;
  }

  // Check BullMQ queue stats if Redis is healthy
  if (checks.redis) {
    try {
      const queueNames = ['ingest', 'transcribe', 'analyze'];
      const queueStats: Record<string, { waiting: number; active: number; completed: number; failed: number }> = {};

      for (const name of queueNames) {
        const queue = new Queue(name, { connection: redisConnection });
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
        queueStats[name] = {
          waiting: counts.waiting,
          active: counts.active,
          completed: counts.completed,
          failed: counts.failed,
        };
        await queue.close();
      }

      checks.workerQueues = queueStats;
    } catch {
      checks.workerQueues = null;
    }
  }

  const status = checks.db && checks.redis ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      version: '0.1.0',
      checks,
    },
    { status: status === 'ok' ? 200 : 503 },
  );
}
