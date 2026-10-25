// @vitest-environment node
/**
 * Liveness contract for GET /api/health.
 *
 * 2026-10-20: /api/health is the cheap liveness probe (deploy gate + uptime
 * monitors). It must not touch DB/Redis/queues — a dependency outage must not
 * take the process-liveness signal down with it. The deep checks moved to
 * /api/health/deep (see health-deep.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';

const spies = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  Queue: vi.fn(),
  // Flipped inside the vi.mock factories: only runs if the route actually
  // imports the module. Importing @/lib/prisma opens a pg Pool and
  // @/lib/redis opens an ioredis connection — the liveness route must stay
  // dependency-free at module scope too, not just at request time.
  loaded: { prisma: false, redis: false, bullmq: false },
}));

vi.mock('@/lib/prisma', () => {
  spies.loaded.prisma = true;
  return { prisma: { $queryRaw: spies.queryRaw } };
});
vi.mock('@/lib/redis', () => {
  spies.loaded.redis = true;
  return { redis: { ping: spies.ping }, redisConnection: {} };
});
vi.mock('bullmq', () => {
  spies.loaded.bullmq = true;
  return { Queue: spies.Queue };
});

import { GET } from '@/app/api/health/route';

describe('GET /api/health (liveness)', () => {
  it('returns 200 ok with the app version', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', version: '0.1.1' });
  });

  it('makes no DB, Redis, or queue calls while serving', async () => {
    await GET();
    expect(spies.queryRaw).not.toHaveBeenCalled();
    expect(spies.ping).not.toHaveBeenCalled();
    expect(spies.Queue).not.toHaveBeenCalled();
  });

  it('does not even load the prisma/redis/bullmq modules', async () => {
    await GET();
    expect(spies.loaded.prisma).toBe(false);
    expect(spies.loaded.redis).toBe(false);
    expect(spies.loaded.bullmq).toBe(false);
  });

  it('answers hot requests with p50 < 100ms', async () => {
    await GET(); // warm-up call pays one-time module-init costs
    const samples: number[] = [];
    for (let i = 0; i < 31; i++) {
      const t0 = performance.now();
      await GET();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)];
    expect(p50).toBeLessThan(100);
  });
});
