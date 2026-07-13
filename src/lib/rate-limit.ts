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
  const now = Date.now();

  const raw = await redis.get(key);

  let entry: { count: number; resetAt: number } | null = null;
  if (raw) {
    try {
      entry = JSON.parse(raw);
    } catch {
      entry = null;
    }
  }

  // Window expired or new entry
  if (!entry || entry.resetAt < now) {
    const newEntry = { count: 1, resetAt: now + config.windowMs };
    await redis.setex(key, Math.ceil(config.windowMs / 1000), JSON.stringify(newEntry));
    return { success: true, limit: config.limit, remaining: config.limit - 1 };
  }

  if (entry.count >= config.limit) {
    return { success: false, limit: config.limit, remaining: 0 };
  }

  entry.count++;
  const ttl = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  await redis.setex(key, ttl, JSON.stringify(entry));

  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
  };
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
