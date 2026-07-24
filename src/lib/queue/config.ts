import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis';

export const INGEST_QUEUE_NAME = 'ingest';
export const TRANSCRIBE_QUEUE_NAME = 'transcribe';
export const ANALYZE_QUEUE_NAME = 'analyze';
export const DIARIZE_QUEUE_NAME = 'diarize';
export const NORMALIZE_QUEUE_NAME = 'normalize_turns';
export const DIGEST_QUEUE_NAME = 'digest'; // C3: weekly RSS polling of followed shows
export const RETENTION_QUEUE_NAME = 'retention'; // A4: daily media cleanup
export const PROJECT_QUEUE_NAME = 'project'; // V2/T-V2-8: semantic atlas projection
export const PERSON_PROFILE_QUEUE_NAME = 'person_profile'; // V3/T-V3-2: person profile rebuild

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, { connection: redisConnection });
export const transcribeQueue = new Queue(TRANSCRIBE_QUEUE_NAME, { connection: redisConnection });
export const analyzeQueue = new Queue(ANALYZE_QUEUE_NAME, { connection: redisConnection });
export const diarizeQueue = new Queue(DIARIZE_QUEUE_NAME, { connection: redisConnection });
export const normalizeQueue = new Queue(NORMALIZE_QUEUE_NAME, { connection: redisConnection });
export const digestQueue = new Queue(DIGEST_QUEUE_NAME, { connection: redisConnection });
export const retentionQueue = new Queue(RETENTION_QUEUE_NAME, { connection: redisConnection });
export const projectQueue = new Queue(PROJECT_QUEUE_NAME, { connection: redisConnection });
export const personProfileQueue = new Queue(PERSON_PROFILE_QUEUE_NAME, { connection: redisConnection });

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
  // Priority disabled for now — BullMQ free tier + single worker doesn't need it.
  // Re-enable with BullMQ Pro or when multiple workers are deployed.
  const job = await ingestQueue.add('ingest', data);
  return job.id || '';
}

export async function addTranscribeJob(data: QueueJob['data'], opts?: { pro?: boolean }): Promise<string> {
  const job = await transcribeQueue.add('transcribe', data);
  return job.id || '';
}

export async function addAnalyzeJob(data: QueueJob['data'], opts?: { pro?: boolean }): Promise<string> {
  const job = await analyzeQueue.add('analyze', data);
  return job.id || '';
}
