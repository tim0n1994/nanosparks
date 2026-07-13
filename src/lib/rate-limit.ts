/**
 * Rate Limiting — Redis INCR + EXPIRE
 *
 * Per Track F.7: migrate from GET/SETEX (race-prone) to atomic INCR+EXPIRE.
 * This is the correct Redis pattern for rate limiting — the INCR and EXPIRE
 * are separate commands but the first INCR sets the key, and the EXPIRE
 * is only set once (on the first request in each window).
 */

import { redis } from '@/lib/redis';

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export async function rateLimit(
  ip: string,
  endpoint: string,
): Promise<{ success: boolean; limit: number; remaining: number }> {
  const config = rateLimitConfig(endpoint);
  const key = getKey(ip, endpoint);

  // Atomic INCR — returns the new count
  const count = await redis.incr(key);

  // Set TTL only on the first request in the window
  if (count === 1) {
    await redis.pexpire(key, config.windowMs);
  }

  const remaining = Math.max(0, config.limit - count);
  const success = count <= config.limit;

  return { success, limit: config.limit, remaining };
}

function getKey(ip: string, endpoint: string): string {
  return `rate_limit:${ip}:${endpoint}`;
}

export function rateLimitConfig(endpoint: string): RateLimitConfig {
  if (endpoint === 'ingest') {
    return { limit: 5, windowMs: 60 * 1000 };
  }
  if (endpoint.startsWith('/api/episodes')) {
    return { limit: 30, windowMs: 60 * 1000 };
  }
  return { limit: 100, windowMs: 60 * 1000 };
}
