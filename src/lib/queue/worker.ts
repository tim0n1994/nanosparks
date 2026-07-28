import { config as loadEnv } from 'dotenv';
loadEnv();

// Force prisma to re-read DATABASE_URL (strip stray quotes from some dotenv versions).
const cleanDbUrl = (process.env.DATABASE_URL || '').replace(/^"|"$/g, '');
if (cleanDbUrl && cleanDbUrl !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = cleanDbUrl;
}

import { redisConnection } from '@/lib/redis';
import { createWorker } from '@/lib/queue/worker-factory';
import { INGEST_QUEUE_NAME, TRANSCRIBE_QUEUE_NAME, ANALYZE_QUEUE_NAME } from '@/lib/queue/config';
import { processIngestJob } from '@/lib/queue/jobs/ingest';
import { processTranscribeJob } from '@/lib/queue/jobs/transcribe';
import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
import { assertClerkConfiguredForProduction } from '@/lib/clerk-utils';

// Fail-fast: refuse to run an unauthenticated worker in production.
assertClerkConfiguredForProduction();
import { processDiarizeJob } from '@/lib/queue/jobs/diarize';
import { processNormalizeTurnsJob } from '@/lib/queue/jobs/normalize-turns';
import { processRetentionJob } from '@/lib/queue/jobs/retention';
import { processProjectJob } from '@/lib/queue/jobs/project';
import { processPersonProfileJob } from '@/lib/queue/jobs/person-profile';
import { PROJECT_QUEUE_NAME, PERSON_PROFILE_QUEUE_NAME } from '@/lib/queue/config';
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
  // TEMP BENCH: 3 concurrent transcribes — Deepgram (cloud) handles parallel.
  concurrency: 3,
  connection: redisConnection,
});

createWorker({
  queueName: ANALYZE_QUEUE_NAME,
  processor: processAnalyzeJob,
  // Upstream (bigmodel.cn) allows concurrent requests per Key, so concurrency=N
  // multiplies throughput directly. NOTE: a second CCR *path* (/messages-2)
  // under the SAME key adds NO parallelism — quota is per-account, not per-path.
  // Real extra throughput needs a second KEY/account, not a second path.
  concurrency: 2,
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

// V2/T-V2-8: Project worker — corpus semantic-atlas projection (UMAP). concurrency=1
// so a large corpus re-projection serializes rather than racing.
createWorker({
  queueName: PROJECT_QUEUE_NAME,
  processor: processProjectJob as unknown as (data: Record<string, unknown>) => Promise<void>,
  concurrency: 1,
  connection: redisConnection,
});

// V3/T-V3-2: Person-profile worker — incremental per-person rebuild.
createWorker({
  queueName: PERSON_PROFILE_QUEUE_NAME,
  processor: processPersonProfileJob as unknown as (data: Record<string, unknown>) => Promise<void>,
  concurrency: 1,
  connection: redisConnection,
});

logger.info('All queue workers started', {
  queues: [INGEST_QUEUE_NAME, TRANSCRIBE_QUEUE_NAME, ANALYZE_QUEUE_NAME, DIARIZE_QUEUE_NAME, NORMALIZE_QUEUE_NAME, RETENTION_QUEUE_NAME, PROJECT_QUEUE_NAME, PERSON_PROFILE_QUEUE_NAME],
  // V2/V3 graph-atlas + person-profile workers also active.
  // (kept inline in the same array for a single source of truth in logs)
});

// Schedule the retention worker as a repeatable daily cleanup (03:00 Asia/Shanghai).
// PRD §A4: MinIO lifecycle retention runs daily; without this the worker never fires.
import { retentionQueue } from '@/lib/queue/config';
retentionQueue.add(
  'retention',
  {},
  {
    repeat: { pattern: '0 3 * * *', tz: 'Asia/Shanghai' },
    jobId: 'retention-daily',
  },
).catch((err) => {
  logger.warn('retention daily cron registration failed', { error: String(err) });
});

// Keep process alive + start the in-process pipeline watchdog (self-healing
// for stuck transcriptions — no extra process needed at deploy time).
import { startWatchdog } from '@/lib/queue/pipeline-watchdog';
startWatchdog();
setInterval(() => {}, 1000 * 60 * 60);
