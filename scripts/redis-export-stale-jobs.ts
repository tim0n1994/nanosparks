/**
 * Ops (2026-10-19 E): export, then optionally clean, stale BullMQ jobs.
 *
 * Usage:
 *   npx tsx scripts/redis-export-stale-jobs.ts <evidence-dir> [--clean] [--before=ISO]
 *
 * Exports every failed and waiting-children job of every queue the worker
 * registers to `<evidence-dir>/redis-stale-jobs-<ts>.json` (id, name, data,
 * failedReason, timestamps). With --clean, removes those older than --before
 * (default 2026-10-01T00:00:00Z — everything from the Mac era; the newest
 * stale job observed was 2026-09-06). Newer jobs are never touched.
 *
 * Orphan ids (set members whose job hash is gone) have no timestamp; they are
 * exported as `orphanIds` and, with --clean, removed from the set directly.
 *
 * STOP THE WORKER FIRST. Flow parents are removed before their failed children:
 * removing a failed child while its parent still waits unblocks the parent into
 * `wait`, and a running worker executes a months-old job immediately
 * (observed 2026-10-19: a July analyze parent re-ran against live data).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Queue, type Job } from 'bullmq';
import { redisConnection } from '@/lib/redis';

const QUEUES = ['ingest', 'transcribe', 'diarize', 'normalize_turns', 'analyze', 'embed', 'project', 'person_profile', 'retention'];

function snapshot(job: Job, state: string) {
  return {
    id: job.id,
    name: job.name,
    state,
    timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    parent: job.parent ?? null,
    data: job.data,
  };
}

/** BullMQ types its client minimally; the sorted-set commands we need are plain ioredis. */
type ZClient = { zrange(key: string, start: number, stop: number): Promise<string[]>; zrem(key: string, ...members: string[]): Promise<number> };

async function collect(q: Queue, state: 'failed' | 'waiting-children') {
  const client = (await q.client) as unknown as ZClient;
  const ids: string[] = await client.zrange(q.toKey(state), 0, -1);
  const jobs = (await q.getJobs([state], 0, -1)).filter((j): j is Job => Boolean(j));
  const known = new Set(jobs.map((j) => String(j.id)));
  const orphanIds = ids.filter((id) => !known.has(id));
  return { jobs, orphanIds };
}

async function main() {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) throw new Error('usage: redis-export-stale-jobs.ts <evidence-dir> [--clean] [--before=ISO]');
  const clean = process.argv.includes('--clean');
  const beforeArg = process.argv.find((a) => a.startsWith('--before='));
  const before = new Date(beforeArg ? beforeArg.slice('--before='.length) : '2026-10-01T00:00:00Z').getTime();
  if (!Number.isFinite(before)) throw new Error('invalid --before');

  const report: Record<string, unknown> = { exportedAt: new Date().toISOString(), clean, before: new Date(before).toISOString(), queues: {} };
  const queues = report.queues as Record<string, unknown>;

  for (const name of QUEUES) {
    const q = new Queue(name, { connection: redisConnection });
    try {
      const failed = await collect(q, 'failed');
      const waitingChildren = await collect(q, 'waiting-children');
      const jobs = [
        ...failed.jobs.map((j) => snapshot(j, 'failed')),
        ...waitingChildren.jobs.map((j) => snapshot(j, 'waiting-children')),
      ];
      const removed = { failed: 0, waitingChildren: 0, orphans: 0, errors: [] as string[] };
      if (clean) {
        // Parents first (see header): a parent removed with its children can
        // never be unblocked by the child removals that follow.
        for (const job of waitingChildren.jobs) {
          if (job.timestamp < before) {
            try { await job.remove({ removeChildren: true }); removed.waitingChildren++; } catch (e) { removed.errors.push(`${job.id}: ${String(e)}`); }
          }
        }
        for (const job of failed.jobs) {
          if ((job.finishedOn ?? job.timestamp) < before) {
            try { await job.remove(); removed.failed++; } catch (e) { if (!String(e).includes('does not exist')) removed.errors.push(`${job.id}: ${String(e)}`); }
          }
        }
        const client = (await q.client) as unknown as ZClient;
        for (const [state, orphans] of [['failed', failed.orphanIds], ['waiting-children', waitingChildren.orphanIds]] as const) {
          if (orphans.length > 0) removed.orphans += await client.zrem(q.toKey(state), ...orphans);
        }
      }
      const after = await q.getJobCounts('failed', 'waiting-children');
      queues[name] = {
        before: {
          failed: failed.jobs.length + failed.orphanIds.length,
          waitingChildren: waitingChildren.jobs.length + waitingChildren.orphanIds.length,
        },
        orphanIds: { failed: failed.orphanIds, waitingChildren: waitingChildren.orphanIds },
        removed,
        after: { failed: after.failed ?? 0, waitingChildren: after['waiting-children'] ?? 0 },
        jobs,
      };
      console.log(
        `${name}: failed ${failed.jobs.length}+${failed.orphanIds.length} orphan → ${after.failed ?? 0}, ` +
        `waiting-children ${waitingChildren.jobs.length}+${waitingChildren.orphanIds.length} orphan → ${after['waiting-children'] ?? 0}` +
        (removed.errors.length ? `, errors ${removed.errors.length}` : ''),
      );
    } finally {
      await q.close();
    }
  }

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `redis-stale-jobs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`wrote ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
