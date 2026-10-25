// @vitest-environment node
/**
 * Deep health contract for GET /api/health/deep.
 *
 * 2026-10-20: the DB/Redis/queue checks that used to live on /api/health
 * moved here unchanged (SELECT 1, redis ping, BullMQ counts for
 * ingest/transcribe/analyze, ok/degraded verdict, same body shape). One
 * deliberate change: a degraded verdict is now HTTP 503 instead of 200 so
 * status-based monitors and gates can see dependency failures.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  getJobCounts: vi.fn(),
  close: vi.fn(),
  Queue: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('@/lib/redis', () => ({ redis: { ping: mocks.ping }, redisConnection: {} }));
vi.mock('bullmq', () => ({
  // Vitest 4 invokes the implementation with  — it must be a
  // constructible , not an arrow.
  Queue: mocks.Queue.mockImplementation(function Queue() {
    return { getJobCounts: mocks.getJobCounts, close: mocks.close };
  }),
}));

import { GET } from '@/app/api/health/deep/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([]);
  mocks.ping.mockResolvedValue('PONG');
  mocks.getJobCounts.mockResolvedValue({ waiting: 1, active: 2, completed: 3, failed: 4 });
  mocks.close.mockResolvedValue(undefined);
  mocks.Queue.mockImplementation(function Queue() {
    return { getJobCounts: mocks.getJobCounts, close: mocks.close };
  });
});

describe('GET /api/health/deep', () => {
  it('returns 200 ok when db and redis are healthy, with queue stats', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.2');
    expect(body.checks).toEqual({
      db: true,
      redis: true,
      workerQueues: {
        ingest: { waiting: 1, active: 2, completed: 3, failed: 4 },
        transcribe: { waiting: 1, active: 2, completed: 3, failed: 4 },
        analyze: { waiting: 1, active: 2, completed: 3, failed: 4 },
      },
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.ping).toHaveBeenCalledTimes(1);
  });

  it('probes each queue once and closes it', async () => {
    await GET();
    expect(mocks.Queue).toHaveBeenCalledTimes(3);
    expect(mocks.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'completed', 'failed');
    expect(mocks.close).toHaveBeenCalledTimes(3);
  });

  it('returns non-200 degraded when redis is down (queue stats skipped)', async () => {
    mocks.ping.mockRejectedValue(new Error('ECONNREFUSED redis'));
    const res = await GET();
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toBe(false);
    expect(body.checks.db).toBe(true);
    expect(body.checks.workerQueues).toBeNull();
    expect(mocks.Queue).not.toHaveBeenCalled();
  });

  it('returns non-200 degraded when the db is down', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const res = await GET();
    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe(false);
    expect(body.checks.redis).toBe(true);
  });

  it('still answers non-200 when both db and redis are down', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('db down'));
    mocks.ping.mockRejectedValue(new Error('redis down'));
    const res = await GET();
    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });
});
