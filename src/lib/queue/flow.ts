/**
 * FlowProducer Job Graph
 *
 * Per Track F.2: replace hardcoded three-stage chain (ingest→transcribe→analyze)
 * with a BullMQ FlowProducer parent-child job tree.
 *
 * BullMQ FlowProducer semantics: LEAF jobs run first; a parent completes only
 * after ALL its children complete. So to express a pipeline order, the LAST
 * stage must be the root and the FIRST stage must be a leaf:
 *
 *   extract (root — runs last, after normalize)
 *     └── normalize_turns (runs only after BOTH transcribe + diarize done = fan-in)
 *           ├── transcribe (leaf — runs first, produces Turn rows)
 *           └── diarize (leaf — runs in parallel, produces DiarizationSegment rows)
 *
 * The audio download happens in the ingest job BEFORE this flow is added, so
 * mediaPath is known at flow-creation time and passed into each leaf's data.
 * normalize + extract read their inputs from the DB (written by the leaves),
 * so they only need conversationId + the fan-in timing this tree guarantees.
*
* Each job is idempotent: keyed by (sourceId + step + runId).
*/

import { FlowProducer } from 'bullmq';
import { redisConnection } from '@/lib/redis';
import {
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
  episodeKey?: string;   // A1: global cache key
  sourceUrl?: string;    // A1: copyright backlink
  platform?: string;     // A1: resolver platform (routes ASR provider)
  episodeId?: string;
  mediaPath?: string;
  mediaKey?: string;
  mimeType?: string;
  youtubeUrl?: string;
  asrProvider?: string;
}

/**
 * Add the full processing pipeline as a job graph.
 * Each node runs when its parent completes.
 */
export async function addProcessingFlow(data: ProcessFlowData): Promise<string> {
  const idempotencyKey = `${data.sourceId}`;
  // Shared context every downstream job needs to resolve the cache conversation.
  const ctx = {
    conversationId: data.conversationId,
    episodeKey: data.episodeKey,
    sourceUrl: data.sourceUrl,
    platform: data.platform,
    episodeId: data.episodeId,
    asrProvider: data.asrProvider,
  };

  // Tree is inverted per BullMQ semantics (leaves run first, parent runs after
  // all children complete). Root = extract (last); leaves = transcribe + diarize
  // (first, parallel); normalize sits between and fans-in BOTH leaves.
  const flow = await flowProducer.add({
    name: 'extract',
    queueName: ANALYZE_QUEUE_NAME,
    data: { ...ctx, step: 'extract' },
    opts: { jobId: `${idempotencyKey}-extract` },
    children: [
      {
        name: 'normalize_turns',
        queueName: NORMALIZE_QUEUE_NAME,
        data: { ...ctx, step: 'normalize_turns' },
        opts: { jobId: `${idempotencyKey}-normalize` },
        children: [
          {
            name: 'transcribe',
            queueName: TRANSCRIBE_QUEUE_NAME,
            data: { ...ctx, mediaPath: data.mediaPath, mediaKey: data.mediaKey, mimeType: data.mimeType, youtubeUrl: data.youtubeUrl, step: 'transcribe' },
            opts: { jobId: `${idempotencyKey}-transcribe` },
          },
          {
            name: 'diarize',
            queueName: DIARIZE_QUEUE_NAME,
            data: { ...ctx, mediaPath: data.mediaPath, mediaKey: data.mediaKey, step: 'diarize' },
            opts: { jobId: `${idempotencyKey}-diarize` },
          },
        ],
      },
    ],
  });

  const jobId = flow?.job?.id ?? '';
  logger.info('Processing flow added', { sourceId: data.sourceId, jobId });
  return jobId;
}
