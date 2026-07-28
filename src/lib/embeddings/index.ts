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
    const rawKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '';
    const baseUrl = process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1';
    const isLocal = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');

    // Local embedding servers (llama.cpp / Ollama / vLLM) ignore the API key —
    // any non-empty string works. Only a *remote* OpenAI endpoint needs a real
    // sk- key; a ccr-dev router key hitting api.openai.com would time out per
    // entity and stall extraction.
    const isPlaceholder =
      !isLocal &&
      (!rawKey ||
        rawKey.startsWith('ccr-') ||
        rawKey === 'placeholder' ||
        (baseUrl === 'https://api.openai.com/v1' && !rawKey.startsWith('sk-')));
    if (isPlaceholder) {
      throw new Error(
        'No embedding API key configured (set EMBEDDING_API_KEY or OPENAI_API_KEY, ' +
          'or point EMBEDDING_BASE_URL to a local server). Vector search will be skipped.',
      );
    }

    const config: EmbeddingConfig = {
      model: (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? EmbeddingModel.OPENAI_TEXT_EMBEDDING_3_SMALL,
      apiKey: rawKey || 'local',
      baseUrl,
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1024', 10),
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
