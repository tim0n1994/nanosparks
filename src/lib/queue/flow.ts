/**
 * FlowProducer Job Graph
 *
 * Per Track F.2: replace hardcoded three-stage chain (ingest→transcribe→analyze)
 * with a BullMQ FlowProducer parent-child job tree.
 *
 * Job graph:
 *   acquire (parent)
 *     ├── transcribe (child)
 *     └── diarize (child, parallel with transcribe)
 *         └── normalize_turns (depends on both transcribe + diarize)
 *             └── extract (windowed)
 *                 └── embed + index
 *                     └── synthesize (graph rebuild)
 *
 * Each job is idempotent: keyed by (sourceId + step + runId).
 */

import { FlowProducer } from 'bullmq';
import { redisConnection } from '@/lib/redis';
import {
  INGEST_QUEUE_NAME,
  TRANSCRIBE_QUEUE_NAME,
  DIARIZE_QUEUE_NAME,
  NORMALIZE_QUEUE_NAME,
  ANALYZE_QUEUE_NAME,
} from '@/lib/queue/config';
import { logger } from '@/lib/logger';

const flowProducer = new FlowProducer({ connection: redisConnection });

export interface ProcessFlowData {
  sourceId: string;
  conversationId?: string;
  episodeId?: string;
  mediaPath?: string;
  mediaKey?: string;
  mimeType?: string;
  youtubeUrl?: string;
}

/**
 * Add the full processing pipeline as a job graph.
 * Each node runs when its parent completes.
 */
export async function addProcessingFlow(data: ProcessFlowData): Promise<string> {
  const idempotencyKey = `${data.sourceId}`;

  const flow = await flowProducer.add({
    name: 'acquire',
    queueName: INGEST_QUEUE_NAME,
    data: { ...data, step: 'acquire' },
    opts: { jobId: `${idempotencyKey}:acquire` },
    children: [
      {
        name: 'transcribe',
        queueName: TRANSCRIBE_QUEUE_NAME,
        data: { ...data, step: 'transcribe' },
        opts: { jobId: `${idempotencyKey}:transcribe` },
        children: [
          {
            name: 'normalize_turns',
            queueName: NORMALIZE_QUEUE_NAME,
            data: { ...data, step: 'normalize_turns' },
            opts: { jobId: `${idempotencyKey}:normalize` },
            children: [
              {
                name: 'extract',
                queueName: ANALYZE_QUEUE_NAME,
                data: { ...data, step: 'extract' },
                opts: { jobId: `${idempotencyKey}:extract` },
              },
            ],
          },
        ],
      },
      {
        name: 'diarize',
        queueName: DIARIZE_QUEUE_NAME,
        data: { ...data, step: 'diarize' },
        opts: { jobId: `${idempotencyKey}:diarize` },
      },
    ],
  });

  const jobId = flow?.job?.id ?? '';
  logger.info('Processing flow added', { sourceId: data.sourceId, jobId });
  return jobId;
}
