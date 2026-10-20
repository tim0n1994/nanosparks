/**
 * Embed Job (2026-10-19) — ThoughtUnit vector embeddings off the analyze
 * critical path.
 *
 * analyze enqueues this job after extraction and finishes the conversation
 * (导读 / `completed`) without waiting for embeddings: on a CPU-only host the
 * local bge-m3 server needs minutes per conversation, and semantic search /
 * the atlas are enhancement layers that must not gate readability.
 *
 * The atlas projection is enqueued from here once the vectors are stored, so
 * a projection never runs on missing vectors. Idempotent: storeEmbedding
 * upserts on (resource_type, resource_id).
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { generateEmbeddings } from '@/lib/embeddings';
import { storeEmbeddings } from '@/lib/embeddings/search';

export interface EmbedJobData {
  conversationId: string;
  corpusId?: string;
}

/** Embed every thought unit of a conversation and upsert the vectors. Returns the count. */
export async function embedConversationThoughtUnits(conversationId: string): Promise<number> {
  const thoughtUnits = await prisma.thoughtUnit.findMany({
    where: { conversationId },
    select: { id: true, text: true },
  });
  if (thoughtUnits.length === 0) return 0;

  const startedAt = Date.now();
  const vectors = await generateEmbeddings(thoughtUnits.map((tu) => tu.text));
  await storeEmbeddings(
    thoughtUnits.map((tu, i) => ({
      resourceType: 'thought_unit',
      resourceId: tu.id,
      vector: vectors[i],
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    })),
  );
  logger.info('Embedding job stored vectors', {
    conversationId,
    count: thoughtUnits.length,
    ms: Date.now() - startedAt,
  });
  return thoughtUnits.length;
}

/**
 * Trigger the corpus atlas projection. One job per corpus per minute: a burst
 * of completions collapses into a single projection without a later one being
 * dropped forever by a stale jobId.
 */
export async function enqueueProjection(corpusId: string): Promise<void> {
  const { projectQueue } = await import('@/lib/queue/config');
  await projectQueue.add(
    'project',
    { corpusId },
    { jobId: `project:${corpusId}:${Math.floor(Date.now() / 60_000)}` },
  );
}

export async function processEmbedJob(data: EmbedJobData): Promise<void> {
  const { conversationId } = data;
  if (!conversationId) throw new Error('embed job requires conversationId');

  const count = await embedConversationThoughtUnits(conversationId);
  if (count === 0) {
    logger.info('Embedding job found no thought units', { conversationId });
    return;
  }

  const corpusId =
    data.corpusId ??
    (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { corpusId: true } }))?.corpusId;
  if (!corpusId) return;
  try {
    await enqueueProjection(corpusId);
  } catch (e) {
    logger.warn('Atlas projection enqueue failed after embedding', { conversationId, corpusId, error: String(e) });
  }
}
