import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimit, rateLimitConfig } from '@/lib/rate-limit';

vi.mock('@/lib/redis', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

import { redis } from '@/lib/redis';

const mockRedisGet = redis.get as ReturnType<typeof vi.fn>;
const mockRedisSetex = redis.setex as ReturnType<typeof vi.fn>;

describe('rateLimit', () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisSetex.mockReset();
  });

  it('allows first request and stores entry in Redis', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisSetex.mockResolvedValue('OK');

    const result = await rateLimit('1.1.1.1', 'ingest');

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
    expect(mockRedisSetex).toHaveBeenCalled();
  });

  it('blocks after limit exceeded', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ count: 5, resetAt: Date.now() + 60000 }));

    const result = await rateLimit('2.2.2.2', 'ingest');

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ count: 5, resetAt: Date.now() - 1 }));
    mockRedisSetex.mockResolvedValue('OK');

    const result = await rateLimit('3.3.3.3', 'ingest');

    expect(result.success).toBe(true);
  });

  it('increments count within window', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ count: 2, resetAt: Date.now() + 60000 }));
    mockRedisSetex.mockResolvedValue('OK');

    const result = await rateLimit('4.4.4.4', 'ingest');

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(2); // 5 - 3
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
