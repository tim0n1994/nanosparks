import { z } from 'zod';

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
  protected cache = new Map<string, { response: LLMResponse; expiresAt: number }>();
  protected cacheTtlMs = 60 * 60 * 1000;

  constructor(apiKey: string, model: string, config: ApiConfig) {
    this.apiKey = apiKey;
    this.model = model;
    this.config = config;
  }

  async complete(
    messages: LLMMessage[],
    maxTokens: number = 4096,
    skipCache?: boolean,
  ): Promise<LLMResponse> {
    const cacheKey = hashMessages(messages, this.model, maxTokens);
    if (!skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.response;
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

    this.cache.set(cacheKey, { response: result, expiresAt: Date.now() + this.cacheTtlMs });
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
