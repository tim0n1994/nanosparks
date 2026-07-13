import { Queue, Worker } from 'bullmq';
import { redis } from '@/lib/redis';

export const INGEST_QUEUE_NAME = 'ingest';
export const TRANSCRIBE_QUEUE_NAME = 'transcribe';
export const ANALYZE_QUEUE_NAME = 'analyze';

export const ingestQueue = new Queue(INGEST_QUEUE_NAME, { connection: redis });
export const transcribeQueue = new Queue(TRANSCRIBE_QUEUE_NAME, { connection: redis });
export const analyzeQueue = new Queue(ANALYZE_QUEUE_NAME, { connection: redis });

interface QueueJob {
  id: string;
  data: Record<string, unknown>;
}

export async function addIngestJob(data: QueueJob['data']): Promise<string> {
  const job = await ingestQueue.add('ingest', data);
  return job.id || '';
}

export async function addTranscribeJob(data: QueueJob['data']): Promise<string> {
  const job = await transcribeQueue.add('transcribe', data);
  return job.id || '';
}

export async function addAnalyzeJob(data: QueueJob['data']): Promise<string> {
  const job = await analyzeQueue.add('analyze', data);
  return job.id || '';
}
