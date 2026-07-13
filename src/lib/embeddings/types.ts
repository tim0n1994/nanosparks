/**
 * Embedding Service Types
 *
 * Types for generating and searching vector embeddings.
 * M0: OpenAI text-embedding-3-small
 * M1: Support local models (e.g. sentence-transformers via ONNX)
 */

/**
 * Supported embedding models.
 */
export enum EmbeddingModel {
  OPENAI_TEXT_EMBEDDING_3_SMALL = 'text-embedding-3-small',
  OPENAI_TEXT_EMBEDDING_3_LARGE = 'text-embedding-3-large',
}

/**
 * Configuration for the embedding service.
 */
export interface EmbeddingConfig {
  model: EmbeddingModel;
  apiKey: string;
  /** Number of dimensions (small=512, large=1024; can be reduced via dimensions param) */
  dimensions?: number;
  /** Base URL for OpenAI-compatible API */
  baseUrl?: string;
}

/**
 * Result of embedding a single text.
 */
export interface EmbeddingResult {
  /** The embedding vector */
  vector: number[];
  /** Model used to generate the embedding */
  model: string;
  /** Number of tokens consumed */
  usage: { promptTokens: number; totalTokens: number };
}

/**
 * Result of embedding multiple texts in batch.
 */
export interface BatchEmbeddingResult {
  vectors: number[][];
  model: string;
  usage: { promptTokens: number; totalTokens: number };
}

/**
 * A search result from vector similarity search.
 */
export interface VectorSearchResult {
  id: string;
  resourceType: string;
  resourceId: string;
  similarity: number; // cosine similarity 0-1
  text?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Interface for embedding providers.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<BatchEmbeddingResult>;
  getModel(): string;
  getDimensions(): number;
}
