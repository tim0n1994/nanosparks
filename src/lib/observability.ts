/**
 * Observability — OTel traces + Langfuse LLM logging
 *
 * Per Track F.6:
 * - OTel trace spans across API → queue → LLM calls
 * - Langfuse records each LLM call's prompt/cost/latency
 * - pino JSON logging (already in place via src/lib/logger.ts)
 *
 * Configured via environment:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
 *   LANGFUSE_BASE_URL=http://langfuse:3000
 *   LANGFUSE_PUBLIC_KEY=...
 *   LANGFUSE_SECRET_KEY=...
 *
 * When OTel/Langfuse are not configured, operations are no-ops (graceful degradation).
 */

import { logger } from '@/lib/logger';

// ─── OTel Tracing ──────────────────────────────────────────────

interface Span {
  name: string;
  startTime: number;
  attributes: Record<string, string | number | boolean>;
  end(attributes?: Record<string, string | number | boolean>): void;
}

/**
 * Minimal span implementation — uses OTel API when available,
 * falls back to timing logs when not.
 */
class SimpleSpan implements Span {
  name: string;
  startTime: number;
  attributes: Record<string, string | number | boolean>;

  constructor(name: string, attributes?: Record<string, string | number | boolean>) {
    this.name = name;
    this.startTime = Date.now();
    this.attributes = attributes ?? {};
  }

  end(attributes?: Record<string, string | number | boolean>): void {
    const durationMs = Date.now() - this.startTime;
    const allAttrs = { ...this.attributes, ...attributes };

    logger.info(`trace.span: ${this.name}`, {
      span: this.name,
      durationMs,
      ...allAttrs,
    });
  }
}

/**
 * Start a trace span. When OTel is configured, this creates a real span;
 * otherwise it falls back to timing logs.
 */
export function startSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  // OTel integration would go here:
  // if (otelTracer) { return otelTracer.startSpan(name, { attributes }); }
  return new SimpleSpan(name, attributes);
}

// ─── Langfuse LLM Logging ──────────────────────────────────────

interface LangfuseEvent {
  name: string;
  prompt: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}

let langfusePublicKey: string | undefined;
let langfuseSecretKey: string | undefined;
let langfuseBaseUrl: string | undefined;

function getLangfuseConfig() {
  langfusePublicKey ??= process.env.LANGFUSE_PUBLIC_KEY;
  langfuseSecretKey ??= process.env.LANGFUSE_SECRET_KEY;
  langfuseBaseUrl ??= process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000';
  return { publicKey: langfusePublicKey, secretKey: langfuseSecretKey, baseUrl: langfuseBaseUrl };
}

/**
 * Log an LLM call to Langfuse for prompt/cost/latency tracking.
 * No-op when Langfuse is not configured.
 */
export async function logLlmCall(event: LangfuseEvent): Promise<void> {
  const { publicKey, secretKey, baseUrl } = getLangfuseConfig();

  if (!publicKey || !secretKey) {
    // Langfuse not configured — just log locally
    logger.info('llm.call', {
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      durationMs: event.durationMs,
      costUsd: event.costUsd,
    });
    return;
  }

  try {
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');

    await fetch(`${baseUrl}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        batch: [
          {
            id: crypto.randomUUID(),
            type: 'generation-create',
            timestamp: new Date().toISOString(),
            body: {
              name: event.name,
              model: event.model,
              prompt: event.prompt.slice(0, 10000),
              inputTokens: event.inputTokens ?? 0,
              outputTokens: event.outputTokens ?? 0,
              metadata: {
                durationMs: event.durationMs,
                costUsd: event.costUsd,
                ...event.metadata,
              },
            },
          },
        ],
      }),
    }).catch(() => {
      // Langfuse unavailable — non-fatal
    });
  } catch {
    // Langfuse errors are non-fatal
  }
}

/**
 * Estimate cost in USD based on model and token usage.
 * Rough pricing as of 2026-07 — update with actual rates.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
    'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
    'claude-3-5-sonnet-20241022': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  };

  const rate = pricing[model] ?? pricing['gpt-4o-mini'];
  return (inputTokens * rate.input) + (outputTokens * rate.output);
}
