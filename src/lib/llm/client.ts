import { z } from 'zod';

/**
 * Strip JSON Schema metadata ($schema, $defs, $ref) that some strict APIs reject.
 * Inlines local $ref references so the result is self-contained structural JSON Schema.
 */
function stripJsonSchemaMeta(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripJsonSchemaMeta);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string') {
      // $ref already resolved upstream by zod-to-json-schema in practice; keep as-is if dangling.
      return { type: 'object', additionalProperties: true };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$schema' || k === '$defs' || k === '$id') continue;
      out[k] = stripJsonSchemaMeta(v);
    }
    return out;
  }
  return node as Record<string, unknown>;
}

/**
 * Convert a Zod schema to a JSON Schema object for structured output APIs.
 * Uses Zod v4's native `z.toJSONSchema()` when available (correct + complete);
 * falls back to a manual converter for Zod v3 environments.
 */
function zodToJsonSchema(schema: z.ZodSchema<any>, name: string): Record<string, unknown> {
  // Zod v4 ships a native, correct converter. Prefer it.
  const zodAny = z as unknown as { toJSONSchema?: (s: z.ZodSchema<any>) => Record<string, unknown> };
  if (typeof zodAny.toJSONSchema === 'function') {
    try {
      return stripJsonSchemaMeta(zodAny.toJSONSchema(schema)) as Record<string, unknown>;
    } catch {
      // fall through to manual converter
    }
  }

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
      // Zod v3: _def.shape is a function; Zod v4: _def.shape is already an object.
      const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {});
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
  /** Optional per-config model override (enables multi-endpoint load balancing
   * where each endpoint fronts a different model, e.g. primary glm-5.2 +
   * secondary glm-5.1). Falls back to the client's model when absent. */
  model?: string;
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
  /** Extra endpoint configs for load balancing (round-robin per call). */
  protected extraConfigs: ApiConfig[] = [];
  private rrIndex = 0;
  protected cacheTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(apiKey: string, model: string, config: ApiConfig) {
    this.apiKey = apiKey;
    this.model = model;
    this.config = config;
  }

  /**
   * Round-robin endpoint selection. Returns the config + model to use for the
   * NEXT request, cycling through primary → secondary(?) → primary... This lets
   * a single client instance spread its calls across multiple upstream endpoints
   * (e.g. glm-5.2 on /messages + glm-5.1 on /messages-2), so one extraction job's
   * 100+ windowed calls use both endpoints' bandwidth.
   */
  protected nextEndpoint(): { config: ApiConfig; model: string } {
    const pool = [this.config, ...this.extraConfigs];
    const cfg = pool[this.rrIndex % pool.length];
    this.rrIndex++;
    return { config: cfg, model: cfg.model ?? this.model };
  }

  /** Attach a secondary endpoint for round-robin load balancing. */
  attachSecondary(config: ApiConfig): void {
    this.extraConfigs.push(config);
  }

  /**
   * Register an additional upstream endpoint for round-robin load balancing.
   * The config is built the same way as the primary (same protocol/key), but
   * can point at a different path/model — e.g. secondary /messages-2 + glm-5.1.
   */
  addExtraEndpoint(config: ApiConfig): void {
    this.extraConfigs.push(config);
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
    // 90s (was 5 min). Normal calls finish in 5-20s; a hung router connection
    // that never RSTs leaves this waiting the full 5 min, stalling windowed
    // extraction. 90s is a generous ceiling that still fails hung windows fast.
    const timeout = setTimeout(() => controller.abort(), 90_000);

    const { config: ep, model: epModel } = this.nextEndpoint();
    let response: Response;
    try {
      response = await fetch(ep.url, {
        method: 'POST',
        headers: ep.headers,
        body: JSON.stringify(ep.body(messages, epModel, maxTokens)),
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

    const schemaName = options?.schemaName || 'output';
    const instruction =
      `\n\nRespond with ONLY valid minified JSON matching this JSON Schema (no prose, no markdown fences):\n` +
      JSON.stringify(jsonSchema);
    const instructedMessages: LLMMessage[] = messages.map((m, i) =>
      i === messages.length - 1
        ? { role: m.role, content: m.content + instruction }
        : m,
    );

    // Retry on 529/1305 (GLM overloaded) with adaptive backoff.
    // P0 fix: was 0% retry → 34% window loss. Now retries with escalating delay.
    // P2 fix: repeated 529 → longer backoff (GLM limiter window ~30s).
    // nextEndpoint() round-robins to secondary if configured.
    const MAX_RETRIES = 5;
    let consecutiveOverloads = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Adaptive backoff: 0 → 2s → 4s → 8s → 15s.
      // If repeated overloads, escalate faster (the account is being throttled).
      if (attempt > 0) {
        const baseDelay = [0, 2000, 4000, 8000, 15000][attempt] ?? 15000;
        const overloadMultiplier = consecutiveOverloads >= 2 ? 2 : 1;
        await sleep(baseDelay * overloadMultiplier);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);

      let response: Response;
      try {
        // nextEndpoint() cycles primary → secondary → primary.
        // If a secondary endpoint is configured (e.g. Gemini), repeated 529s
        // on GLM will naturally rotate to the backup after each retry.
        const { config: ep, model: epModel } = this.nextEndpoint();
        response = await fetch(ep.url, {
          method: 'POST',
          headers: ep.headers,
          body: JSON.stringify({
            ...(ep.body(instructedMessages, epModel, maxTokens) as Record<string, unknown>),
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
        const errorText = await response.text();
        const isOverloaded = response.status === 529 || errorText.includes('1305') || errorText.includes('overloaded');

        if (isOverloaded) {
          consecutiveOverloads++;
          if (attempt < MAX_RETRIES - 1) {
            continue;
          }
        }

        throw new Error(`Structured output API error: ${response.status} ${errorText.slice(0, 500)}`);
      }

      // Success.
      consecutiveOverloads = 0;
      const data = await response.json();
      const content = this.config.extractContent(data);
      return schema.parse(parseLenientJson(content, schemaName));
    }

    throw new Error('Structured output exhausted all retries');
  }
}

// --- Claude Client ---

export class ClaudeClient extends BaseLLMClient {
  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022', baseUrl?: string) {
    const messagesUrl = baseUrl
      ? (/\/messages(-\d+)?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/messages`)
      : 'https://api.anthropic.com/v1/messages';
    super(apiKey, model, {
      url: messagesUrl,
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

/**
 * Build the primary ApiConfig for a given endpoint + protocol. Used both for the
 * main client and to construct secondary configs for load balancing.
 */
function buildApiConfig(
  format: 'openai' | 'anthropic',
  apiKey: string,
  baseUrl: string,
): ApiConfig {
  const base = baseUrl.replace(/\/+$/, '');
  if (format === 'anthropic') {
    return {
      // If baseUrl already ends in /messages (a specific router path like
      // /v1/messages-2), use it verbatim; otherwise append /messages.
      url: /\/messages\b/.test(base) ? base : `${base}/messages`,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
      extractContent: (data) => {
        const d = data as { content: Array<{ type: string; text: string }> };
        return d.content[0]?.text || '';
      },
      extractUsage: (data) => {
        const d = data as { usage: { input_tokens: number; output_tokens: number } };
        return { inputTokens: d.usage.input_tokens, outputTokens: d.usage.output_tokens };
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
    extractContent: (data) => {
      const d = data as { choices: Array<{ message: { content: string } }> };
      return d.choices[0]?.message?.content || '';
    },
    extractUsage: (data) => {
      const d = data as { usage: { prompt_tokens: number; completion_tokens: number } };
      return { inputTokens: d.usage.prompt_tokens, outputTokens: d.usage.completion_tokens };
    },
  };
}

/**
 * Attach the secondary endpoint from saved settings to an existing client.
 * Use when the client was built from routed settings (which don't carry the
 * secondary) but you still want round-robin load balancing across both endpoints.
 */
export async function attachSecondaryFromSettings(client: BaseLLMClient): Promise<void> {
  try {
    const { getLlmSettings } = await import('@/lib/settings');
    const s = await getLlmSettings();
    if (s.secondary?.baseUrl && s.secondary.model) {
      const secFormat = s.secondary.apiFormat ?? s.apiFormat ?? 'openai';
      const secConfig = buildApiConfig(secFormat, s.apiKey, s.secondary.baseUrl);
      secConfig.model = s.secondary.model;
      client.attachSecondary(secConfig);
    }
  } catch {
    /* secondary is optional; ignore failures */
  }
}

/**
 * Construct the right LLM client for current settings, with an optional
 * secondary endpoint attached for round-robin load balancing. Replaces the
 * scattered `apiFormat === 'anthropic' ? new ClaudeClient : new OpenAIClient`
 * patterns so all call sites get multi-endpoint support for free.
 */
export async function createLlmClient(): Promise<BaseLLMClient> {
  const { getLlmSettings } = await import('@/lib/settings');
  const s = await getLlmSettings();
  const format = s.apiFormat ?? 'openai';
  const client = new (format === 'anthropic' ? ClaudeClient : OpenAIClient)(s.apiKey, s.model, s.baseUrl);
  if (s.secondary?.baseUrl && s.secondary.model) {
    const secFormat = s.secondary.apiFormat ?? format;
    const secConfig = buildApiConfig(secFormat, s.apiKey, s.secondary.baseUrl);
    secConfig.model = s.secondary.model;
    client.attachSecondary(secConfig);
  }
  return client;
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

/**
 * Parse an LLM response that is supposed to be JSON but may be wrapped in
 * markdown fences or surrounded by prose. Returns the parsed JS value.
 */
export function parseLenientJson(content: string, schemaName = 'output'): unknown {
  const trimmed = (content || '').trim();
  // 1. ```json ... ``` fenced block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    return JSON.parse(fence[1].trim());
  }
  // 2. Raw JSON already.
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  // 3. First { ... last } (object) or first [ ... last ] (array).
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  let start = -1;
  let close = '';
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj; close = '}';
  } else if (firstArr !== -1) {
    start = firstArr; close = ']';
  }
  if (start !== -1) {
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }
  throw new Error(`Could not parse JSON from ${schemaName} response: ${trimmed.slice(0, 200)}`);
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
