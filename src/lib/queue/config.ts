import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis';

export const INGEST_QUEUE_NAME = 'ingest';
export const TRANSCRIBE_QUEUE_NAME = 'transcribe';
export const ANALYZE_QUEUE_NAME = 'analyze';
export const DIARIZE_QUEUE_NAME = 'diarize';
export const NORMALIZE_QUEUE_NAME = 'normalize_turns';
export const DIGEST_QUEUE_NAME = 'digest'; // C3: weekly RSS polling of followed shows
export const RETENTION_QUEUE_NAME = 'retention'; // A4: daily media cleanup

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, { connection: redisConnection });
export const transcribeQueue = new Queue(TRANSCRIBE_QUEUE_NAME, { connection: redisConnection });
export const analyzeQueue = new Queue(ANALYZE_QUEUE_NAME, { connection: redisConnection });
export const diarizeQueue = new Queue(DIARIZE_QUEUE_NAME, { connection: redisConnection });
export const normalizeQueue = new Queue(NORMALIZE_QUEUE_NAME, { connection: redisConnection });
export const digestQueue = new Queue(DIGEST_QUEUE_NAME, { connection: redisConnection });
export const retentionQueue = new Queue(RETENTION_QUEUE_NAME, { connection: redisConnection });

interface QueueJob {
  id: string;
  data: Record<string, unknown>;
  /** BullMQ priority: lower number = higher priority (PRD §A4 付费用户队列优先). */
  priority?: number;
}

/**
 * Add an ingest job. Pro users get higher priority (lower number) per PRD §A4/§7.
 * BullMQ orders jobs by priority asc, so paid users jump the queue.
 */
export async function addIngestJob(data: QueueJob['data'], opts?: { pro?: boolean }): Promise<string> {
  const priority = opts?.pro ? 1 : 10;
  const job = await ingestQueue.add('ingest', data, { priority });
  return job.id || '';
}

export async function addTranscribeJob(data: QueueJob['data'], opts?: { pro?: boolean }): Promise<string> {
  const priority = opts?.pro ? 1 : 10;
  const job = await transcribeQueue.add('transcribe', data, { priority });
  return job.id || '';
}

export async function addAnalyzeJob(data: QueueJob['data'], opts?: { pro?: boolean }): Promise<string> {
  const priority = opts?.pro ? 1 : 10;
  const job = await analyzeQueue.add('analyze', data, { priority });
  return job.id || '';
}
