import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@/lib/logger';

interface WorkerConfig<T> {
  queueName: string;
  processor: (data: T) => Promise<void>;
  concurrency?: number;
  redis: Redis;
}

export function createWorker<T>(config: WorkerConfig<T>): Worker {
  const worker = new Worker(
    config.queueName,
    async (job: Job) => {
      await config.processor(job.data as T);
    },
    {
      connection: config.redis,
      concurrency: config.concurrency ?? 1,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`${config.queueName} job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`${config.queueName} job ${job?.id} failed`, { error: err.message });
  });

  return worker;
}
