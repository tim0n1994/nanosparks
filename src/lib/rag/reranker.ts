/**
 * Cross-encoder Reranker
 *
 * Per Track D.3: RRF-fused top-20~30 → reranker → top 5–8 for LLM context.
 * Two modes:
 *   1. Local: bge-reranker-v2-m3 via Python script (self-hosted, free, multilingual)
 *   2. Cloud: Cohere Rerank API or Voyage rerank API
 *
 * Configured via environment:
 *   RERANKER_PROVIDER=local|cohere|voyage  (default: local)
 *   RERANKER_MODEL=bge-reranker-v2-m3       (local model name)
 *   RERANKER_API_KEY=...                     (for cloud providers)
 *   RERANKER_TOP_K=8                         (final number of results)
 *
 * Budget: +50–200ms latency, acceptable per plan.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'path';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

export interface RerankCandidate {
  /** Unique ID of the candidate (e.g. ThoughtUnit ID) */
  id: string;
  /** Text to evaluate relevance against the query */
  text: string;
  /** Original RRF score (for fallback ordering) */
  originalScore: number;
  /** Additional metadata passthrough */
  [key: string]: unknown;
}

export interface RerankResult<T extends RerankCandidate = RerankCandidate> {
  /** The candidate, reordered by reranker relevance */
  candidate: T;
  /** Relevance score from the reranker (0-1, higher = more relevant) */
  relevanceScore: number;
  /** Original position before reranking (0-indexed) */
  originalPosition: number;
}

export type RerankerProvider = 'local' | 'cohere' | 'voyage' | 'none';

export interface RerankerOptions {
  /** Provider: local (bge-reranker), cohere, voyage, or none (skip reranking) */
  provider?: RerankerProvider;
  /** Model name for local mode */
  model?: string;
  /** API key for cloud providers */
  apiKey?: string;
  /** Final number of results to return */
  topK?: number;
}

/**
 * Get the reranker provider from environment.
 */
function getProvider(): RerankerProvider {
  const provider = (process.env.RERANKER_PROVIDER ?? 'local').toLowerCase();
  if (provider === 'cohere' || provider === 'voyage' || provider === 'local' || provider === 'none') {
    return provider as RerankerProvider;
  }
  return 'local';
}

/**
 * Rerank candidates using a local cross-encoder model (bge-reranker-v2-m3).
 *
 * Calls a Python script that loads the model and computes relevance scores.
 * The script receives the query and candidates as JSON via stdin.
 */
async function rerankLocal<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  model: string,
  topK: number,
): Promise<RerankResult<T>[]> {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'bge_rerank.py');

  const input = JSON.stringify({
    query,
    model,
    top_k: topK,
    documents: candidates.map((c) => ({ id: c.id, text: c.text })),
  });

  try {
    const { stdout } = await execFileAsync(
      'python3',
      [scriptPath],
      {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        input,
      } as Record<string, unknown>,
    );

    const result = JSON.parse(stdout as string) as Array<{
      id: string;
      score: number;
      index: number;
    }>;

    return result.map((r) => ({
      candidate: candidates[r.index] ?? candidates[0],
      relevanceScore: r.score,
      originalPosition: r.index,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('not installed') || msg.includes('No module named') || msg.includes('ENOENT')) {
      logger.warn('bge-reranker not available, skipping reranking (returning original order)');
      // Fallback: return candidates in original order, truncated to topK
      return candidates.slice(0, topK).map((c, i) => ({
        candidate: c,
        relevanceScore: c.originalScore,
        originalPosition: i,
      }));
    }
    throw new Error(`Local reranker failed: ${msg}`);
  }
}

/**
 * Rerank candidates using the Cohere Rerank API.
 */
async function rerankCohere<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  apiKey: string,
  topK: number,
): Promise<RerankResult<T>[]> {
  const response = await fetch('https://api.cohere.ai/v1/rerank', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'rerank-multilingual-v3.0',
      query,
      documents: candidates.map((c) => c.text),
      top_n: topK,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Cohere rerank API error ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };

  return data.results.map((r) => ({
    candidate: candidates[r.index],
    relevanceScore: r.relevance_score,
    originalPosition: r.index,
  }));
}

/**
 * Rerank candidates using the Voyage rerank API.
 */
async function rerankVoyage<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  apiKey: string,
  topK: number,
): Promise<RerankResult<T>[]> {
  const response = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'rerank-2',
      query,
      documents: candidates.map((c) => c.text),
      top_k: topK,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Voyage rerank API error ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    data: Array<{ index: number; relevance_score: number }>;
  };

  return data.data.map((r) => ({
    candidate: candidates[r.index],
    relevanceScore: r.relevance_score,
    originalPosition: r.index,
  }));
}

/**
 * Rerank search candidates using a cross-encoder model.
 *
 * @param query The user's search query
 * @param candidates RRF-fused candidates (top 20-30)
 * @param options Reranker configuration
 * @returns Top-K candidates reordered by cross-encoder relevance
 */
export async function rerank<T extends RerankCandidate>(
  query: string,
  candidates: T[],
  options?: RerankerOptions,
): Promise<RerankResult<T>[]> {
  const provider = options?.provider ?? getProvider();
  const topK = options?.topK ?? parseInt(process.env.RERANKER_TOP_K ?? '8', 10);

  if (candidates.length === 0) return [];

  // If provider is 'none' or candidates <= topK, skip reranking
  if (provider === 'none' || candidates.length <= topK) {
    logger.info('Reranking skipped', {
      provider,
      candidates: candidates.length,
      topK,
      reason: provider === 'none' ? 'disabled' : 'candidates <= topK',
    });
    return candidates.slice(0, topK).map((c, i) => ({
      candidate: c,
      relevanceScore: c.originalScore,
      originalPosition: i,
    }));
  }

  // Limit to top-30 for reranking (per plan: "RRF 后 top-20~30")
  const rerankPool = candidates.slice(0, 30);

  logger.info('Reranking candidates', {
    provider,
    poolSize: rerankPool.length,
    topK,
  });

  try {
    let results: RerankResult<T>[];

    switch (provider) {
      case 'local':
        results = await rerankLocal(
          query,
          rerankPool,
          options?.model ?? process.env.RERANKER_MODEL ?? 'bge-reranker-v2-m3',
          topK,
        );
        break;

      case 'cohere':
        results = await rerankCohere(
          query,
          rerankPool,
          options?.apiKey ?? process.env.RERANKER_API_KEY ?? '',
          topK,
        );
        break;

      case 'voyage':
        results = await rerankVoyage(
          query,
          rerankPool,
          options?.apiKey ?? process.env.RERANKER_API_KEY ?? '',
          topK,
        );
        break;

      default:
        return rerankPool.slice(0, topK).map((c, i) => ({
          candidate: c,
          relevanceScore: c.originalScore,
          originalPosition: i,
        }));
    }

    logger.info('Reranking completed', {
      inputCount: rerankPool.length,
      outputCount: results.length,
      topScore: results[0]?.relevanceScore,
    });

    return results;
  } catch (error) {
    logger.warn('Reranking failed, falling back to RRF order', { error: String(error) });
    // Fallback: return RRF-ordered candidates truncated to topK
    return rerankPool.slice(0, topK).map((c, i) => ({
      candidate: c,
      relevanceScore: c.originalScore,
      originalPosition: i,
    }));
  }
}
