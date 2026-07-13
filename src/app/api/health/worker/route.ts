/**
 * GET /api/health/worker
 *
 * Worker health endpoint — queue depth, failure rate, worker heartbeat.
 * Prometheus-compatible format (text/plain with metrics).
 */

import { NextRequest, NextResponse } from 'next/server';
import { redisConnection } from '@/lib/redis';
import { Queue } from 'bullmq';

export const dynamic = 'force-dynamic';

const QUEUE_NAMES = ['ingest', 'transcribe', 'analyze'];

export async function GET(request: NextRequest) {
  const accept = request.headers.get('accept') || '';
  const prometheusFormat = accept.includes('text/plain');

  const queueStats: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number }> = {};

  for (const name of QUEUE_NAMES) {
    try {
      const queue = new Queue(name, { connection: redisConnection });
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      queueStats[name] = {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed,
      };
      await queue.close();
    } catch {
      queueStats[name] = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
  }

  const totalFailed = Object.values(queueStats).reduce((s, q) => s + q.failed, 0);
  const totalCompleted = Object.values(queueStats).reduce((s, q) => s + q.completed, 0);
  const failureRate = totalCompleted + totalFailed > 0
    ? totalFailed / (totalCompleted + totalFailed)
    : 0;

  if (prometheusFormat) {
    const lines: string[] = [];
    lines.push('# HELP bullmq_queue_waiting Number of waiting jobs');
    lines.push('# TYPE bullmq_queue_waiting gauge');
    for (const [name, stats] of Object.entries(queueStats)) {
      lines.push(`bullmq_queue_waiting{queue="${name}"} ${stats.waiting}`);
    }
    lines.push('# HELP bullmq_queue_active Number of active jobs');
    lines.push('# TYPE bullmq_queue_active gauge');
    for (const [name, stats] of Object.entries(queueStats)) {
      lines.push(`bullmq_queue_active{queue="${name}"} ${stats.active}`);
    }
    lines.push('# HELP bullmq_queue_failed_total Total failed jobs');
    lines.push('# TYPE bullmq_queue_failed_total counter');
    for (const [name, stats] of Object.entries(queueStats)) {
      lines.push(`bullmq_queue_failed_total{queue="${name}"} ${stats.failed}`);
    }
    lines.push('# HELP bullmq_failure_rate Overall job failure rate');
    lines.push('# TYPE bullmq_failure_rate gauge');
    lines.push(`bullmq_failure_rate ${failureRate.toFixed(4)}`);

    return new NextResponse(lines.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    });
  }

  return NextResponse.json({
    status: failureRate < 0.1 ? 'ok' : 'degraded',
    queues: queueStats,
    failureRate: Number(failureRate.toFixed(4)),
  });
}
