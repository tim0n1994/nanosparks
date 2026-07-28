/**
 * pgvector Similarity Search
 *
 * Handles vector similarity search against the embeddings table.
 * Uses raw SQL via Prisma.sql (parameterized) so the vector literal is
 * injected safely — string concatenation caused a syntax error (code 42601)
 * because Prisma's $queryRawUnsafe double-escaped the bracket literal.
 *
 * The embeddings table stores vectors as `vector(1024)` (bge-m3 native).
 * Cosine similarity is computed via the `<=>` operator.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import type { VectorSearchResult } from './types';
import { logger } from '@/lib/logger';

export interface VectorSearchOptions {
  limit?: number;
  minSimilarity?: number;
  resourceType?: string;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = 0.5;

/**
 * Build a pgvector-safe SQL fragment from a number[] query vector.
 * The vector string is joined from trusted in-process numbers (never user text),
 * wrapped in [] and cast to ::vector.
 */
function vectorLiteral(queryVector: number[]): Prisma.Sql {
  return Prisma.sql`'[${Prisma.raw(queryVector.join(','))}]'::vector`;
}

/**
 * Search for similar content by vector similarity.
 * Uses cosine distance via pgvector's `<=>` operator.
 */
export async function vectorSearch(
  queryVector: number[],
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const vl = vectorLiteral(queryVector);

  try {
    const typeFilter = options.resourceType
      ? Prisma.sql`AND e.resource_type = ${options.resourceType}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      resource_type: string;
      resource_id: string;
      similarity: number;
    }>>(Prisma.sql`
      SELECT
        e.id,
        e.resource_type,
        e.resource_id,
        1 - (e.embedding <=> ${vl}) AS similarity
      FROM embeddings e
      WHERE 1=1
      ${typeFilter}
      AND 1 - (e.embedding <=> ${vl}) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      similarity: Number(row.similarity),
    }));
  } catch (error) {
    logger.error('Vector search failed', { error: String(error) });
    throw new Error(`Vector search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Search ThoughtUnits by vector similarity.
 * Joins with the thought_units table to return text content.
 */
export async function searchThoughtUnits(
  queryVector: number[],
  options: VectorSearchOptions & {
    maxTextLength?: number;
  } = {},
): Promise<Array<VectorSearchResult & { text: string; type: string }>> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const maxTextLength = options.maxTextLength ?? 500;
  const vl = vectorLiteral(queryVector);

  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      resource_id: string;
      similarity: number;
      text: string;
      type: string;
    }>>(Prisma.sql`
      SELECT
        e.id,
        e.resource_id,
        1 - (e.embedding <=> ${vl}) AS similarity,
        LEFT(tu.text, ${maxTextLength}) AS text,
        tu.type AS type
      FROM embeddings e
      JOIN "ThoughtUnit" tu ON tu.id = e.resource_id AND e.resource_type = 'thought_unit'
      WHERE 1 - (e.embedding <=> ${vl}) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      resourceType: 'thought_unit',
      resourceId: row.resource_id,
      similarity: Number(row.similarity),
      text: row.text,
      type: row.type,
    }));
  } catch (error) {
    logger.error('Thought unit vector search failed', { error: String(error) });
    throw new Error(`Thought unit search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Store an embedding vector for a resource.
 * Creates or updates the embedding record.
 */
export async function storeEmbedding(
  resourceType: string,
  resourceId: string,
  vector: number[],
  model: string,
): Promise<void> {
  const vectorStr = `[${vector.join(',')}]`;

  try {
    await prisma.$executeRaw`
      INSERT INTO embeddings (resource_type, resource_id, embedding, model)
      VALUES (${resourceType}, ${resourceId}, ${vectorStr}::vector, ${model})
      ON CONFLICT (resource_type, resource_id)
      DO UPDATE SET embedding = ${vectorStr}::vector, model = ${model}, updated_at = NOW()
    `;
  } catch (error) {
    logger.error('Failed to store embedding', { error: String(error) });
    throw new Error(`Failed to store embedding: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Bulk store embeddings for multiple resources.
 * Best-effort: individual errors are logged but do not stop the batch.
 */
export async function storeEmbeddings(
  entries: Array<{
    resourceType: string;
    resourceId: string;
    vector: number[];
    model: string;
  }>,
): Promise<void> {
  if (entries.length === 0) return;

  for (const entry of entries) {
    try {
      await storeEmbedding(
        entry.resourceType,
        entry.resourceId,
        entry.vector,
        entry.model,
      );
    } catch (err) {
      logger.warn('Failed to store single embedding', {
        resourceId: entry.resourceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
