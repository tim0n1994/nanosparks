import { redisConnection } from '@/lib/redis';
import { createWorker } from '@/lib/queue/worker-factory';
import { INGEST_QUEUE_NAME, TRANSCRIBE_QUEUE_NAME, ANALYZE_QUEUE_NAME } from '@/lib/queue/config';
import { processIngestJob } from '@/lib/queue/jobs/ingest';
import { processTranscribeJob } from '@/lib/queue/jobs/transcribe';
import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
import { logger } from '@/lib/logger';

// Create all workers using the unified factory
createWorker({
  queueName: INGEST_QUEUE_NAME,
  processor: processIngestJob,
  concurrency: 2,
  connection: redisConnection,
});

createWorker({
  queueName: TRANSCRIBE_QUEUE_NAME,
  processor: processTranscribeJob,
  concurrency: 1,
  connection: redisConnection,
});

createWorker({
  queueName: ANALYZE_QUEUE_NAME,
  processor: processAnalyzeJob,
  concurrency: 1,
  connection: redisConnection,
});

logger.info('All queue workers started');

// Keep process alive
setInterval(() => {}, 1000 * 60 * 60);

