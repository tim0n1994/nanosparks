import { Queue } from 'bullmq';
import { redisConnection } from '@/lib/redis';
import { queueJobOptions } from '@/lib/queue/job-policy';

export const INGEST_QUEUE_NAME = 'ingest';
export const TRANSCRIBE_QUEUE_NAME = 'transcribe';
export const ANALYZE_QUEUE_NAME = 'analyze';
export const DIARIZE_QUEUE_NAME = 'diarize';
export const NORMALIZE_QUEUE_NAME = 'normalize_turns';
export const RETENTION_QUEUE_NAME = 'retention'; // A4: daily media cleanup
export const PROJECT_QUEUE_NAME = 'project'; // V2/T-V2-8: semantic atlas projection
export const PERSON_PROFILE_QUEUE_NAME = 'person_profile'; // V3/T-V3-2: person profile rebuild
export const EMBED_QUEUE_NAME = 'embed'; // 2026-10-19: TU embeddings off the analyze critical path

function pipelineQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection, defaultJobOptions: queueJobOptions(name) });
}

export const ingestQueue = pipelineQueue(INGEST_QUEUE_NAME);
export const transcribeQueue = pipelineQueue(TRANSCRIBE_QUEUE_NAME);
export const analyzeQueue = pipelineQueue(ANALYZE_QUEUE_NAME);
export const diarizeQueue = pipelineQueue(DIARIZE_QUEUE_NAME);
export const normalizeQueue = pipelineQueue(NORMALIZE_QUEUE_NAME);
export const retentionQueue = pipelineQueue(RETENTION_QUEUE_NAME);
export const projectQueue = pipelineQueue(PROJECT_QUEUE_NAME);
export const personProfileQueue = pipelineQueue(PERSON_PROFILE_QUEUE_NAME);
export const embedQueue = pipelineQueue(EMBED_QUEUE_NAME);

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
