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
    let apiKey = process.env.OPENAI_API_KEY;
    let baseUrl: string | undefined;

    // Try reading from DB settings first
    try {
      const { getLlmSettings } = await import('@/lib/settings');
      const settings = await getLlmSettings();
      if (settings.apiKey) apiKey = settings.apiKey;
      baseUrl = settings.baseUrl;
    } catch {
      // Fall through to env defaults
    }

    if (!apiKey) {
      throw new Error(
        'API key is required for embedding generation. ' +
          'Set it in Settings page or via OPENAI_API_KEY in .env',
      );
    }

    const config: EmbeddingConfig = {
      model: EmbeddingModel.OPENAI_TEXT_EMBEDDING_3_SMALL,
      apiKey,
      baseUrl,
      dimensions: 512, // text-embedding-3-small with 512 dims (fast, cheap, good)
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
