/**
 * Hybrid Search — BM25 (Postgres FTS) + Dense (pgvector) + RRF fusion
 *
 * Per Track D of the iteration plan:
 * 1. Dense top-50 (pgvector cosine)
 * 2. FTS top-50 (tsvector GIN index)
 * 3. Reciprocal Rank Fusion to merge (no raw score mixing — classic pitfall)
 * 4. Optional cross-encoder rerank on top 20-30
 * 5. Graph expansion as second hop (supports/contradicts/answers)
 *
 * RRF formula: score(d) = Σ 1 / (k + rank_i(d))
 * where k=60 (community standard)
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface SearchResult {
  thoughtUnitId: string;
  text: string;
  type: string;
  conversationId: string;
  /** Final RRF score (higher = better) */
  score: number;
  /** Dense similarity score (if from vector search) */
  denseScore?: number;
  /** BM25 rank (if from FTS) */
  ftsRank?: number;
  /** Whether this result was expanded from graph */
  graphExpanded?: boolean;
}

export interface HybridSearchOptions {
  /** Number of results from each retriever before fusion */
  topK?: number;
  /** RRF constant (default 60, community standard) */
  rrfK?: number;
  /** Final number of results to return */
  limit?: number;
  /** Whether to expand via graph edges (second hop) */
  graphExpansion?: boolean;
  /** Corpus to search within */
  corpusId: string;
}

const DEFAULT_TOP_K = 50;
const DEFAULT_RRF_K = 60;
const DEFAULT_LIMIT = 10;

interface DenseResult {
  thoughtUnitId: string;
  text: string;
  type: string;
  conversationId: string;
  similarity: number;
}

interface FtsResult {
  thoughtUnitId: string;
  text: string;
  type: string;
  conversationId: string;
  rank: number;
}

/**
 * Dense vector search via pgvector.
 */
async function denseSearch(
  queryVector: number[],
  corpusId: string,
  limit: number,
): Promise<DenseResult[]> {
  const vectorStr = `[${queryVector.join(',')}]`;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      thoughtUnitId: string;
      text: string;
      type: string;
      conversationId: string;
      similarity: number;
    }>>(
      `SELECT
        tu.id AS "thoughtUnitId",
        LEFT(tu.text, 500) AS "text",
        tu.type AS "type",
        tu."conversationId" AS "conversationId",
        1 - (e.embedding <=> ${vectorStr}::vector) AS similarity
      FROM embeddings e
      JOIN "ThoughtUnit" tu ON tu.id = e.resource_id AND e.resource_type = 'thought_unit'
      JOIN "Conversation" c ON c.id = tu."conversationId"
      WHERE c."corpusId" = $1
      ORDER BY e.embedding <=> ${vectorStr}::vector
      LIMIT $2`,
      corpusId,
      limit,
    );

    return rows.map((r) => ({
      thoughtUnitId: r.thoughtUnitId,
      text: r.text,
      type: r.type,
      conversationId: r.conversationId,
      similarity: Number(r.similarity),
    }));
  } catch (error) {
    logger.warn('Dense search failed', { error: String(error) });
    return [];
  }
}

/**
 * BM25 search via Postgres FTS (tsvector).
 */
async function ftsSearch(
  query: string,
  corpusId: string,
  limit: number,
): Promise<FtsResult[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      thoughtUnitId: string;
      text: string;
      type: string;
      conversationId: string;
      rank: number;
    }>>(
      `SELECT
        tu.id AS "thoughtUnitId",
        LEFT(tu.text, 500) AS "text",
        tu.type AS "type",
        tu."conversationId" AS "conversationId",
        ts_rank(tu.search_tsv, plainto_tsquery('simple', $1)) AS rank
      FROM "ThoughtUnit" tu
      JOIN "Conversation" c ON c.id = tu."conversationId"
      WHERE c."corpusId" = $2
        AND tu.search_tsv @@ plainto_tsquery('simple', $1)
      ORDER BY rank DESC
      LIMIT $3`,
      query,
      corpusId,
      limit,
    );

    return rows.map((r) => ({
      thoughtUnitId: r.thoughtUnitId,
      text: r.text,
      type: r.type,
      conversationId: r.conversationId,
      rank: Number(r.rank),
    }));
  } catch (error) {
    logger.warn('FTS search failed', { error: String(error) });
    return [];
  }
}

/**
 * Reciprocal Rank Fusion.
 * Merges multiple ranked lists into a single ranked list.
 * score(d) = Σ 1 / (k + rank_i(d))
 */
export function reciprocalRankFusion<T>(
  rankedLists: Array<Array<T>>,
  k: number = DEFAULT_RRF_K,
): Array<{ item: T; score: number }> {
  const scores = new Map<T, number>();

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const current = scores.get(item) ?? 0;
      scores.set(item, current + 1 / (k + rank + 1)); // rank is 0-indexed, +1 for 1-indexed
    });
  }

  return [...scores.entries()]
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Graph expansion — second hop via GraphEdge.
 * Given seed ThoughtUnit IDs, expand to related TUs via supports/contradicts/answers.
 */
async function graphExpand(
  seedTuIds: string[],
  corpusId: string,
  limit: number,
): Promise<Array<{ thoughtUnitId: string; relation: string }>> {
  if (seedTuIds.length === 0) return [];

  try {
    // GraphNodes store canonicalText which may match TU text, but the
    // connection is through the corpus graph. We look up nodes whose
    // label matches TU text, then traverse edges.
    const edges = await prisma.graphEdge.findMany({
      where: {
        corpusId,
        relation: { in: ['supports', 'contradicts', 'answers'] },
        OR: [
          {
            sourceNode: {
              kind: 'claim_cluster',
              label: { in: seedTuIds },
            },
          },
          {
            targetNode: {
              kind: 'claim_cluster',
              label: { in: seedTuIds },
            },
          },
        ],
      },
      include: {
        sourceNode: { select: { id: true, label: true, kind: true } },
        targetNode: { select: { id: true, label: true, kind: true } },
      },
      take: limit,
    });

    const expanded = new Map<string, string>();
    for (const edge of edges) {
      const sourceLabel = edge.sourceNode.label;
      const targetLabel = edge.targetNode.label;
      if (seedTuIds.includes(sourceLabel) && !seedTuIds.includes(targetLabel)) {
        expanded.set(targetLabel, edge.relation);
      }
      if (seedTuIds.includes(targetLabel) && !seedTuIds.includes(sourceLabel)) {
        expanded.set(sourceLabel, edge.relation);
      }
    }

    return [...expanded.entries()].map(([thoughtUnitId, relation]) => ({
      thoughtUnitId,
      relation,
    }));
  } catch (error) {
    logger.warn('Graph expansion failed', { error: String(error) });
    return [];
  }
}

/**
 * Full hybrid search pipeline: dense + FTS → RRF → graph expansion.
 */
export async function hybridSearch(
  query: string,
  queryVector: number[],
  options: HybridSearchOptions,
): Promise<SearchResult[]> {
  const {
    topK = DEFAULT_TOP_K,
    rrfK = DEFAULT_RRF_K,
    limit = DEFAULT_LIMIT,
    graphExpansion = true,
    corpusId,
  } = options;

  // Run dense and FTS in parallel
  const [denseResults, ftsResults] = await Promise.all([
    denseSearch(queryVector, corpusId, topK),
    ftsSearch(query, corpusId, topK),
  ]);

  logger.info('Hybrid search retrieved', {
    dense: denseResults.length,
    fts: ftsResults.length,
  });

  // Build ranked lists for RRF (by id)
  const denseRanked = denseResults
    .sort((a, b) => b.similarity - a.similarity)
    .map((r) => r.thoughtUnitId);
  const ftsRanked = ftsResults
    .sort((a, b) => b.rank - a.rank)
    .map((r) => r.thoughtUnitId);

  // RRF fusion
  const fused = reciprocalRankFusion([denseRanked, ftsRanked], rrfK);

  // Build result objects with metadata
  const tuMap = new Map<string, { text: string; type: string; conversationId: string }>();
  for (const r of denseResults) {
    tuMap.set(r.thoughtUnitId, {
      text: r.text,
      type: r.type,
      conversationId: r.conversationId,
    });
  }
  for (const r of ftsResults) {
    if (!tuMap.has(r.thoughtUnitId)) {
      tuMap.set(r.thoughtUnitId, {
        text: r.text,
        type: r.type,
        conversationId: r.conversationId,
      });
    }
  }

  let results: SearchResult[] = fused.slice(0, limit * 3).map(({ item, score }) => {
    const meta = tuMap.get(item);
    const denseHit = denseResults.find((r) => r.thoughtUnitId === item);
    const ftsHit = ftsResults.find((r) => r.thoughtUnitId === item);
    return {
      thoughtUnitId: item,
      text: meta?.text ?? '',
      type: meta?.type ?? 'unknown',
      conversationId: meta?.conversationId ?? '',
      score,
      denseScore: denseHit?.similarity,
      ftsRank: ftsHit?.rank,
    };
  });

  // Graph expansion (second hop)
  if (graphExpansion && results.length > 0) {
    const seedIds = results.slice(0, limit).map((r) => r.thoughtUnitId);
    const expanded = await graphExpand(seedIds, corpusId, limit);

    for (const exp of expanded) {
      if (!results.find((r) => r.thoughtUnitId === exp.thoughtUnitId)) {
        // Fetch the expanded TU
        const tu = await prisma.thoughtUnit.findUnique({
          where: { id: exp.thoughtUnitId },
          select: { text: true, type: true, conversationId: true },
        });
        if (tu) {
          results.push({
            thoughtUnitId: exp.thoughtUnitId,
            text: tu.text.slice(0, 500),
            type: tu.type,
            conversationId: tu.conversationId,
            score: 0, // expanded items have no RRF score
            graphExpanded: true,
          });
        }
      }
    }
  }

  // Final limit
  return results.slice(0, limit);
}
