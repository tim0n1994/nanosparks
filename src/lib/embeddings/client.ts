/**
 * OpenAI Embedding Client
 *
 * Generates vector embeddings using OpenAI's text-embedding-3-small/large API.
 * M0 default: text-embedding-3-small (512 dimensions, fast + cheap).
 * Batch support for efficient processing of multiple texts.
 */

import {
  EmbeddingModel,
  EmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  EmbeddingProvider,
} from './types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * OpenAI embedding provider.
 * Thread-safe and stateless — instantiate once and reuse.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly baseUrl: string;

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions ?? 512; // default: text-embedding-3-small with reduced dims
    this.baseUrl = config.baseUrl ?? OPENAI_BASE_URL;
  }

  getModel(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const result = await this.embedBatch([text]);
    return {
      vector: result.vectors[0],
      model: result.model,
      usage: result.usage,
    };
  }

  /**
   * Embed multiple texts in a single API call.
   * More efficient than individual calls for batched operations.
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      return { vectors: [], model: this.model, usage: { promptTokens: 0, totalTokens: 0 } };
    }

    // Truncate each text to prevent token overflow (max 8191 tokens for text-embedding-3-small)
    const sanitizedTexts = texts.map((t) => {
      if (typeof t !== 'string') return '';
      // Rough char → token estimate: ~4 chars per token, cap at ~30k chars (safety margin)
      return t.length > 30000 ? t.slice(0, 30000) : t;
    });

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: sanitizedTexts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI embedding API error (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    // Sort by index to match input order, extract vectors
    const vectors = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    return {
      vectors,
      model: this.model,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }
}
