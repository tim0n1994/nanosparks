import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimit, rateLimitConfig } from '@/lib/rate-limit';

vi.mock('@/lib/redis', () => ({
  redis: {
    incr: vi.fn(),
    pexpire: vi.fn(),
  },
  redisConnection: { url: 'redis://localhost:6379', maxRetriesPerRequest: null },
}));

import { redis } from '@/lib/redis';

const mockRedisIncr = redis.incr as ReturnType<typeof vi.fn>;
const mockRedisPexpire = redis.pexpire as ReturnType<typeof vi.fn>;

describe('rateLimit', () => {
  beforeEach(() => {
    mockRedisIncr.mockReset();
    mockRedisPexpire.mockReset();
  });

  it('allows first request and sets TTL on first INCR', async () => {
    mockRedisIncr.mockResolvedValue(1);
    mockRedisPexpire.mockResolvedValue(1);

    const result = await rateLimit('1.1.1.1', 'ingest');

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4); // limit=5, count=1
    expect(mockRedisPexpire).toHaveBeenCalled(); // TTL set on first request
  });

  it('does not set TTL on subsequent requests', async () => {
    mockRedisIncr.mockResolvedValue(2);
    mockRedisPexpire.mockResolvedValue(1);

    const result = await rateLimit('1.1.1.1', 'ingest');

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(3); // limit=5, count=2
    expect(mockRedisPexpire).not.toHaveBeenCalled(); // TTL already set
  });

  it('blocks after limit exceeded', async () => {
    mockRedisIncr.mockResolvedValue(6); // count=6, limit=5

    const result = await rateLimit('2.2.2.2', 'ingest');

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('increments count within window', async () => {
    mockRedisIncr.mockResolvedValue(3); // count=3

    const result = await rateLimit('4.4.4.4', 'ingest');

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2); // 5 - 3
  });

  it('handles boundary: exactly at limit', async () => {
    mockRedisIncr.mockResolvedValue(5); // count=5 = limit

    const result = await rateLimit('5.5.5.5', 'ingest');

    expect(result.success).toBe(true); // count <= limit
    expect(result.remaining).toBe(0);
  });
});

describe('rateLimitConfig', () => {
  it('returns ingest limits', () => {
    const config = rateLimitConfig('ingest');
    expect(config.limit).toBe(5);
    expect(config.windowMs).toBe(60000);
  });

  it('returns default limits for unknown endpoints', () => {
    const config = rateLimitConfig('/api/other');
    expect(config.limit).toBe(100);
  });
});
