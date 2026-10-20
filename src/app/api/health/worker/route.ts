/**
 * GET /api/health/worker
 *
 * Worker health endpoint — queue depth, failure rate, Redis reachability.
 * Prometheus-compatible format (text/plain with metrics).
 *
 * 2026-10-19: covers every queue the worker registers (was 3 of 8), adds
 * waiting-children, and reports Redis failure as HTTP 503 with `redisOk:false`
 * instead of zeroed counts — an unreachable queue must never look idle
 * (docs/next-release-acceptance-2026-09-09.md hazard #3).
 */

import { NextRequest, NextResponse } from 'next/server';
import { redisConnection } from '@/lib/redis';
import { Queue } from 'bullmq';

export const dynamic = 'force-dynamic';

/** Mirrors the worker registration in src/lib/queue/worker.ts. */
const QUEUE_NAMES = [
  'ingest',
  'transcribe',
  'diarize',
  'normalize_turns',
  'analyze',
  'embed',
  'project',
  'person_profile',
  'retention',
] as const;

/** BullMQ reconnects forever (maxRetriesPerRequest:null), so bound each probe. */
const PROBE_TIMEOUT_MS = 4_000;

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waitingChildren: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`queue probe timed out after ${ms}ms`)), ms)),
  ]);
}

export async function GET(request: NextRequest) {
  const accept = request.headers.get('accept') || '';
  const prometheusFormat = accept.includes('text/plain');

  const queueStats: Record<string, QueueStats> = {};
  let redisError: string | null = null;

  for (const name of QUEUE_NAMES) {
    const queue = new Queue(name, { connection: redisConnection });
    try {
      const counts = await withTimeout(
        queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children'),
        PROBE_TIMEOUT_MS,
      );
      queueStats[name] = {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
        waitingChildren: counts['waiting-children'] ?? 0,
      };
    } catch (err) {
      redisError = err instanceof Error ? err.message : String(err);
      break; // one shared connection: first failure describes them all
    } finally {
      await queue.close().catch(() => {});
    }
  }

  if (redisError) {
    if (prometheusFormat) {
      return new NextResponse('bullmq_redis_up 0\n', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      });
    }
    return NextResponse.json(
      { status: 'unavailable', redisOk: false, error: redisError, queues: queueStats },
      { status: 503 },
    );
  }

  const totalFailed = Object.values(queueStats).reduce((s, q) => s + q.failed, 0);
  const totalCompleted = Object.values(queueStats).reduce((s, q) => s + q.completed, 0);
  const failureRate = totalCompleted + totalFailed > 0 ? totalFailed / (totalCompleted + totalFailed) : 0;

  if (prometheusFormat) {
    const lines: string[] = [];
    lines.push('# HELP bullmq_redis_up Whether the queue backend is reachable');
    lines.push('# TYPE bullmq_redis_up gauge');
    lines.push('bullmq_redis_up 1');
    const gauge = (metric: string, help: string, value: (q: QueueStats) => number) => {
      lines.push(`# HELP ${metric} ${help}`);
      lines.push(`# TYPE ${metric} gauge`);
      for (const [name, stats] of Object.entries(queueStats)) lines.push(`${metric}{queue="${name}"} ${value(stats)}`);
    };
    gauge('bullmq_queue_waiting', 'Number of waiting jobs', (q) => q.waiting);
    gauge('bullmq_queue_active', 'Number of active jobs', (q) => q.active);
    gauge('bullmq_queue_delayed', 'Number of delayed jobs', (q) => q.delayed);
    gauge('bullmq_queue_waiting_children', 'Number of flow jobs waiting for children', (q) => q.waitingChildren);
    gauge('bullmq_queue_failed_total', 'Total failed jobs', (q) => q.failed);
    lines.push('# HELP bullmq_failure_rate Overall job failure rate');
    lines.push('# TYPE bullmq_failure_rate gauge');
    lines.push(`bullmq_failure_rate ${failureRate.toFixed(4)}`);

    return new NextResponse(lines.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    });
  }

  return NextResponse.json({
    status: failureRate < 0.1 ? 'ok' : 'degraded',
    redisOk: true,
    queues: queueStats,
    failureRate: Number(failureRate.toFixed(4)),
  });
}
