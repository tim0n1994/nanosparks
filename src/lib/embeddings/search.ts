/**
 * pgvector Similarity Search
 *
 * Handles vector similarity search against the embeddings table.
 * Uses raw SQL since Prisma doesn't natively support vector types.
 *
 * The embeddings table stores vectors as `vector(512)` (matching text-embedding-3-small).
 * Cosine similarity is computed via the `<=>` operator.
 */

import { prisma } from '@/lib/prisma';
import type { VectorSearchResult } from './types';
import { logger } from '@/lib/logger';

export interface VectorSearchOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
  /** Filter by resource type (e.g. 'thought_unit') */
  resourceType?: string;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_SIMILARITY = 0.5;

/**
 * Search for similar content by vector similarity.
 *
 * Uses cosine distance via pgvector's `<=>` operator.
 * The query vector is passed as a PostgreSQL array literal.
 */
export async function vectorSearch(
  queryVector: number[],
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  // pgvector requires a quoted bracket literal: '[1,0,...]'::vector. The bare
  // [1,0,...] form is a syntax error; quoting is safe here because queryVector
  // is a trusted in-process numeric array (never user text).
  const vectorStr = `'[${queryVector.join(',')}]'`;

  const typeFilter = options.resourceType
    ? `AND e.resource_type = '${options.resourceType.replace(/'/g, "''")}'`
    : '';

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      resource_type: string;
      resource_id: string;
      similarity: number;
    }>>(
      `SELECT
        e.id,
        e.resource_type,
        e.resource_id,
        1 - (e.embedding <=> ${vectorStr}::vector) AS similarity
      FROM embeddings e
      WHERE 1=1
      ${typeFilter}
      AND 1 - (e.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}`,
    );

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
    /** Maximum number of characters per text result */
    maxTextLength?: number;
  } = {},
): Promise<Array<VectorSearchResult & { text: string; type: string }>> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const maxTextLength = options.maxTextLength ?? 500;
  // See vectorSearch: pgvector literal must be quoted ('[1,0,...]'::vector).
  const vectorStr = `'[${queryVector.join(',')}]'`;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      resource_id: string;
      similarity: number;
      text: string;
      type: string;
    }>>(
      `SELECT
        e.id,
        e.resource_id,
        1 - (e.embedding <=> ${vectorStr}::vector) AS similarity,
        LEFT(tu.text, ${maxTextLength}) AS text,
        tu.type AS type
      FROM embeddings e
      JOIN "ThoughtUnit" tu ON tu.id = e.resource_id AND e.resource_type = 'thought_unit'
      WHERE 1 - (e.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}`,
    );

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
    await prisma.$executeRawUnsafe(
      `INSERT INTO embeddings (resource_type, resource_id, embedding, model)
       VALUES ($1, $2, $3::vector, $4)
       ON CONFLICT (resource_type, resource_id)
       DO UPDATE SET embedding = $3::vector, model = $4, updated_at = NOW()`,
      resourceType,
      resourceId,
      vectorStr,
      model,
    );
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
      logger.warn(`Failed to store embedding for ${entry.resourceType}:${entry.resourceId}`, {
        error: String(err),
      });
      // Continue with remaining entries (best-effort)
    }
  }
}
