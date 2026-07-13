import { redisConnection } from '@/lib/redis';
import { createWorker } from '@/lib/queue/worker-factory';
import { INGEST_QUEUE_NAME, TRANSCRIBE_QUEUE_NAME, ANALYZE_QUEUE_NAME } from '@/lib/queue/config';
import { processIngestJob } from '@/lib/queue/jobs/ingest';
import { processTranscribeJob } from '@/lib/queue/jobs/transcribe';
import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
import { processDiarizeJob } from '@/lib/queue/jobs/diarize';
import { processNormalizeTurnsJob } from '@/lib/queue/jobs/normalize-turns';
import { processRetentionJob } from '@/lib/queue/jobs/retention';
import { logger } from '@/lib/logger';

export const DIARIZE_QUEUE_NAME = 'diarize';
export const NORMALIZE_QUEUE_NAME = 'normalize_turns';
export const RETENTION_QUEUE_NAME = 'retention';

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

// I2: Diarization worker — runs in parallel with transcribe
createWorker({
  queueName: DIARIZE_QUEUE_NAME,
  processor: processDiarizeJob,
  concurrency: 1,
  connection: redisConnection,
});

// I2: Normalize turns worker — merges ASR words + diarization segments
createWorker({
  queueName: NORMALIZE_QUEUE_NAME,
  processor: processNormalizeTurnsJob,
  concurrency: 1,
  connection: redisConnection,
});

// F.1: Retention worker — daily cleanup of expired media assets
createWorker({
  queueName: RETENTION_QUEUE_NAME,
  processor: processRetentionJob,
  concurrency: 1,
  connection: redisConnection,
});

logger.info('All queue workers started', {
  queues: [INGEST_QUEUE_NAME, TRANSCRIBE_QUEUE_NAME, ANALYZE_QUEUE_NAME, DIARIZE_QUEUE_NAME, NORMALIZE_QUEUE_NAME, RETENTION_QUEUE_NAME],
});

// Keep process alive
setInterval(() => {}, 1000 * 60 * 60);
