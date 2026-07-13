import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const globalForRedis = global as unknown as { redis: Redis };

export const redis = globalForRedis.redis ?? new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

/**
 * Plain connection options for libraries (like BullMQ) that bundle their
 * own ioredis version and reject a cross-version Redis instance on type-check.
 */
export const redisConnection = {
  url: redisUrl,
  maxRetriesPerRequest: null as number | null,
};
