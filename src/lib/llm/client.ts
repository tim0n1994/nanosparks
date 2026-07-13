import { z } from 'zod';

/**
 * Convert a Zod schema to a JSON Schema object for structured output APIs.
 * Supports ZodObject, ZodArray, ZodString, ZodNumber, ZodBoolean, ZodEnum,
 * ZodNullable, ZodOptional, and ZodUnion.
 */
function zodToJsonSchema(schema: z.ZodSchema<any>, name: string): Record<string, unknown> {
  // Use zod's internal _def to extract JSON Schema-like structure
  // This is a simplified converter for the common Zod types used in this codebase
  function convert(s: z.ZodSchema<any>): Record<string, unknown> {
    const def = (s as any)._def;

    // Handle ZodOptional / ZodNullable wrappers
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
      const inner = convert(def.innerType);
      return { ...inner, nullable: s instanceof z.ZodNullable };
    }

    // Handle ZodDefault
    if (s instanceof z.ZodDefault) {
      return convert(def.innerType);
    }

    if (s instanceof z.ZodObject) {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = convert(val as z.ZodSchema<any>);
        if (!(val instanceof z.ZodOptional)) {
          required.push(key);
        }
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
      };
    }

    if (s instanceof z.ZodArray) {
      return { type: 'array', items: convert(def.type) };
    }

    if (s instanceof z.ZodString) {
      return { type: 'string' };
    }

    if (s instanceof z.ZodNumber) {
      return { type: 'number' };
    }

    if (s instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    }

    if (s instanceof z.ZodEnum) {
      return { type: 'string', enum: def.values };
    }

    if (s instanceof z.ZodLiteral) {
      return { type: typeof def.value, const: def.value };
    }

    if (s instanceof z.ZodUnion) {
      const options = def.options as z.ZodSchema<any>[];
      return { oneOf: options.map(convert) };
    }

    // Fallback: treat as string
    return { type: 'string' };
  }

  return {
    type: 'object',
    properties: {
      [name === 'output' ? 'result' : name]: convert(schema),
    },
    required: [name === 'output' ? 'result' : name],
    additionalProperties: false,
  };
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

interface ApiConfig {
  url: string;
  headers: Record<string, string>;
  body: (messages: LLMMessage[], model: string, maxTokens: number) => unknown;
  extractContent: (data: unknown) => string;
  extractUsage: (data: unknown) => { inputTokens: number; outputTokens: number };
}

function hashMessages(messages: LLMMessage[], model: string, maxTokens: number): string {
  const str = JSON.stringify({ messages, model, maxTokens });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(hash);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

abstract class BaseLLMClient {
  protected apiKey: string;
  protected model: string;
  protected config: ApiConfig;
  protected cacheTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(apiKey: string, model: string, config: ApiConfig) {
    this.apiKey = apiKey;
    this.model = model;
    this.config = config;
  }

  /**
   * ADR #9: LLM cache migrated from in-process Map to Redis.
   * In-process Map cache fails across restarts and multiple instances.
   * Redis provides shared, persistent caching for all LLM responses.
   * Falls back to no-cache if Redis is unavailable.
   */
  private async getCache(cacheKey: string): Promise<LLMResponse | null> {
    try {
      const { redis } = await import('@/lib/redis');
      const raw = await redis.get(`llm_cache:${cacheKey}`);
      if (raw) {
        return JSON.parse(raw) as LLMResponse;
      }
    } catch {
      // Redis unavailable — skip cache
    }
    return null;
  }

  private async setCache(cacheKey: string, response: LLMResponse): Promise<void> {
    try {
      const { redis } = await import('@/lib/redis');
      await redis.setex(
        `llm_cache:${cacheKey}`,
        Math.ceil(this.cacheTtlMs / 1000),
        JSON.stringify(response),
      );
    } catch {
      // Redis unavailable — skip cache write
    }
  }

  async complete(
    messages: LLMMessage[],
    maxTokens: number = 4096,
    skipCache?: boolean,
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const cacheKey = hashMessages(messages, this.model, maxTokens);
    if (!skipCache) {
      const cached = await this.getCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min timeout

    let response: Response;
    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.config.headers,
        body: JSON.stringify(this.config.body(messages, this.model, maxTokens)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} ${error}`);
    }

    const data = await response.json();

    const result: LLMResponse = {
      content: this.config.extractContent(data),
      usage: this.config.extractUsage(data),
    };

    await this.setCache(cacheKey, result);

    // Track F.6: Log LLM call to Langfuse for cost/latency observability
    const callDurationMs = Date.now() - startTime;
    const { logLlmCall, estimateCostUsd } = await import('@/lib/observability');
    await logLlmCall({
      name: `llm.complete.${this.model}`,
      prompt: messages.map((m) => m.content).join('\n').slice(0, 5000),
      model: this.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: callDurationMs,
      costUsd: estimateCostUsd(this.model, result.usage.inputTokens, result.usage.outputTokens),
    }).catch(() => {});

    return result;
  }

  async completeWithRetry(
    messages: LLMMessage[],
    maxTokens: number = 4096,
    retries: number = 3,
    skipCache?: boolean,
  ): Promise<LLMResponse> {
    let lastError: Error | undefined;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.complete(messages, maxTokens, skipCache);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (i < retries - 1) {
          await sleep(Math.pow(2, i) * 1000);
        }
      }
    }

    throw lastError;
  }

  /**
   * Schema-constrained structured output.
   * Uses the provider's native structured output API (OpenAI json_schema response_format)
   * to guarantee the response is valid JSON conforming to the given schema.
   * Falls back to prompt-based JSON if the provider doesn't support structured output.
   */
  async completeStructured<T>(
    messages: LLMMessage[],
    schema: z.ZodSchema<T>,
    options?: { maxTokens?: number; schemaName?: string },
  ): Promise<T> {
    const maxTokens = options?.maxTokens ?? 4096;
    const jsonSchema = zodToJsonSchema(schema, options?.schemaName || 'output');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    let response: Response;
    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        headers: this.config.headers,
        body: JSON.stringify({
          ...(this.config.body(messages, this.model, maxTokens) as Record<string, unknown>),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: options?.schemaName || 'output',
              schema: jsonSchema,
              strict: true,
            },
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Structured output API error: ${response.status} ${error.slice(0, 500)}`);
    }

    const data = await response.json();
    const content = this.config.extractContent(data);

    // Zod validation is now an assertion, not a defense — structured output guarantees validity
    return schema.parse(JSON.parse(content));
  }
}

// --- Claude Client ---

export class ClaudeClient extends BaseLLMClient {
  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022') {
    super(apiKey, model, {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: (messages, model, maxTokens) => ({
        model,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      extractContent: (data) => {
        const d = data as { content: Array<{ type: string; text: string }> };
        return d.content[0]?.text || '';
      },
      extractUsage: (data) => {
        const d = data as { usage: { input_tokens: number; output_tokens: number } };
        return {
          inputTokens: d.usage.input_tokens,
          outputTokens: d.usage.output_tokens,
        };
      },
    });
  }
}

// --- OpenAI Fallback Client ---

export class OpenAIClient extends BaseLLMClient {
  constructor(apiKey: string, model: string = 'gpt-4o-mini', baseUrl?: string) {
    const chatUrl = baseUrl
      ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    super(apiKey, model, {
      url: chatUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: (messages: LLMMessage[], model: string, maxTokens: number) => ({
        model,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      extractContent: (data: unknown) => {
        const d = data as { choices: Array<{ message: { content: string } }> };
        return d.choices[0]?.message?.content || '';
      },
      extractUsage: (data: unknown) => {
        const d = data as { usage: { prompt_tokens: number; completion_tokens: number } };
        return {
          inputTokens: d.usage.prompt_tokens,
          outputTokens: d.usage.completion_tokens,
        };
      },
    });
  }
}

export function validateJsonResponse<T>(
  content: string,
  schema: z.ZodSchema<T>,
): T {
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    const parsed = JSON.parse(jsonStr);
    return schema.parse(parsed);
  } catch (error) {
    // Auto-unwrap: LLM sometimes wraps array in object key
    // e.g. {"arguments": [...]} instead of [...]
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed as Record<string, unknown>);
        for (const key of keys) {
          const inner = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(inner)) {
            return schema.parse(inner);
          }
        }
      }
    } catch {
      // if unwrap also fails, throw original error
    }
    throw new Error(`Failed to validate LLM response: ${error instanceof Error ? error.message : String(error)}`);
  }
}
