/**
 * Embedding Service — Public API
 *
 * Usage:
 *   import { getEmbeddingProvider, generateEmbedding } from '@/lib/embeddings';
 *
 *   const vector = await generateEmbedding('Some text to embed');
 */

export { EmbeddingModel } from './types';
export type {
  EmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  EmbeddingProvider,
  VectorSearchResult,
} from './types';
export { OpenAIEmbeddingProvider } from './client';

import { EmbeddingModel } from './types';
import type { EmbeddingProvider, EmbeddingConfig } from './types';
import { OpenAIEmbeddingProvider } from './client';

/**
 * Get or create the default embedding provider (singleton).
 * Reads baseUrl and apiKey from LLM settings (DB), falling back to env vars.
 */
let defaultProvider: EmbeddingProvider | null = null;

export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!defaultProvider) {
    // Embeddings use a dedicated endpoint config — they must NOT inherit the LLM
    // baseUrl, because many chat-only endpoints (e.g. CCR/glm Anthropic-Messages
    // gateways) don't expose /embeddings and would 404. Prefer explicit embedding
    // env vars; fall back to OpenAI's real embedding endpoint when a key exists.
    const rawKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1';

    // A placeholder/router key (e.g. ccr-dev-...) is not a real OpenAI key and
    // the default OpenAI endpoint will reject it after a network timeout PER
    // entity — stalling extraction. Treat it as unconfigured so callers skip
    // embeddings immediately instead of burning 8s × N entities.
    const isPlaceholder =
      !rawKey ||
      rawKey.startsWith('ccr-') ||
      rawKey === 'placeholder' ||
      (baseUrl === 'https://api.openai.com/v1' && !rawKey.startsWith('sk-'));
    if (isPlaceholder) {
      throw new Error(
        'No embedding API key configured (set EMBEDDING_API_KEY or OPENAI_API_KEY). ' +
          'Vector search and similarity graph edges will be skipped.',
      );
    }
    const apiKey = rawKey;

    const config: EmbeddingConfig = {
      // Track D.5: Configurable multilingual embedding model.
      // Defaults to text-embedding-3-small@512d for backward compat.
      // Upgrade to text-embedding-3-large@1024d or Qwen3-Embedding via env.
      model: (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? EmbeddingModel.OPENAI_TEXT_EMBEDDING_3_SMALL,
      apiKey,
      baseUrl,
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '512', 10),
    };

    defaultProvider = new OpenAIEmbeddingProvider(config);
  }
  return defaultProvider;
}

/**
 * Reset the cached provider (call after settings change).
 */
export function resetEmbeddingProvider(): void {
  defaultProvider = null;
}

/**
 * Quick helper: generate a single embedding vector.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const provider = await getEmbeddingProvider();
  const result = await provider.embed(text);
  return result.vector;
}

/**
 * Quick helper: generate embeddings for multiple texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = await getEmbeddingProvider();
  const result = await provider.embedBatch(texts);
  return result.vectors;
}
