/**
 * Reliable window extraction — fast-tier reliability layer (2026-10-21 iter3, M1).
 *
 * The configured fast-tier model is the cheap first pass of
 * windowed extraction, but the iter2 blind eval measured real failure modes in
 * its gateway outputs: parseable-but-empty extractions (P012), token-cap
 * truncation that salvageTruncatedJson silently trimmed into partial results
 * (P028), and unescaped-quote JSON that fails to parse (P030).
 *
 * This layer validates every fast extraction call four ways before accepting:
 *   ① parseable        — completeStructuredChecked throws on unparseable JSON
 *   ② required fields  — the top-level `thoughtUnits` key must exist in the
 *                        RAW JSON (windowExtractionSchema's `.optional().default([])`
 *                        would otherwise mask its absence)
 *   ③ not truncated    — upstream finish_reason === 'length' throws
 *                        TruncatedOutputError inside the client, BEFORE the
 *                        salvage path can wash a cut payload into a partial one
 *   ④ non-empty        — zero thought units AND zero entities is rejected
 *
 * On a validation failure: retry the same model once; if it still fails, fall
 * back to the auto tier (default-settings OpenAIClient, model pinned to
 * 'auto') through the PLAIN extractFromWindow path — the auto arm is the A/B
 * control and deliberately gets no reliability wrapper. Every retry and
 * fallback is recorded as a jsonl event (logger.warn + append to
 * NSP_FALLBACK_EVENT_LOG, default <repo>/.omo/fallback-events.jsonl).
 *
 * Transport-level failures (HTTP errors, timeouts — already retried inside
 * completeStructured and again by analyze.ts's window-retry loop) are rethrown
 * untouched: they are not output-quality failures.
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OpenAIClient, TruncatedOutputError } from '@/lib/llm/client';
import { WINDOWED_THOUGHT_EXTRACTION_PROMPT } from '@/lib/llm/prompts/argument-extraction';
import { logger } from '@/lib/logger';
import {
  WINDOW_MAX_TOKENS,
  extractFromWindow,
  mapStructuredWindowResult,
  windowExtractionSchema,
  type TranscriptWindow,
  type WindowExtractionResult,
} from './windowed-extraction';

/** Why a fast-tier extraction attempt was rejected. */
export type ReliabilityFailureReason = 'parse_fail' | 'truncated' | 'empty' | 'missing_field';

/** One reliability-layer event, appended to the jsonl log. */
export interface FallbackEvent {
  ts: string;
  windowIndex?: number;
  conversationId?: string;
  stage: 'retry' | 'fallback';
  reason: ReliabilityFailureReason;
  model: string;
  fallbackModel: string;
}

export const DEFAULT_FALLBACK_MODEL = 'auto';

/** Resolve the event-log path: NSP_FALLBACK_EVENT_LOG, else <repo>/.omo/fallback-events.jsonl. */
export function fallbackEventLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.NSP_FALLBACK_EVENT_LOG || path.join(process.cwd(), '.omo', 'fallback-events.jsonl');
}

/**
 * The fast tier is the flash-fast model family used for cheap first-pass
 * extraction (for example, any model whose name includes "fast"). Everything else — including the
 * 'auto' control arm — stays on the plain extraction path.
 */
export function isFastTierModel(model: string | undefined): boolean {
  return typeof model === 'string' && /fast/i.test(model);
}

/**
 * Build the fallback client: default LLM settings endpoint with the model
 * pinned to the fallback tier ('auto') — never the fast route, even when the
 * saved default model itself is the fast one.
 */
export async function createAutoFallbackClient(
  fallbackModel: string = DEFAULT_FALLBACK_MODEL,
): Promise<OpenAIClient> {
  const { getLlmSettings } = await import('@/lib/settings');
  const s = await getLlmSettings();
  return new OpenAIClient(s.apiKey, fallbackModel, s.baseUrl);
}

/** logger.warn + append one event line to the jsonl log (best-effort write). */
export function logReliabilityEvent(
  event: FallbackEvent,
  logPath: string = fallbackEventLogPath(),
): void {
  logger.warn('fast-tier extraction reliability event', { ...event });
  try {
    appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  } catch (error) {
    logger.warn('failed to append fallback event log', { logPath, error: String(error) });
  }
}

/**
 * Map a caught completeStructuredChecked error to a failure reason, or null
 * when it is a transport-level error (HTTP/timeout) — those must rethrow.
 */
function classifyCaughtError(error: unknown): ReliabilityFailureReason | null {
  if (error instanceof TruncatedOutputError) return 'truncated';
  const message = error instanceof Error ? error.message : String(error);
  // completeStructured already retried empty content internally; still empty.
  if (message.includes('returned empty content after')) return 'empty';
  if (error instanceof z.ZodError) return 'parse_fail';
  if (message.includes('Could not parse JSON')) return 'parse_fail';
  return null;
}

type FastAttempt =
  | { kind: 'pass'; result: WindowExtractionResult }
  | { kind: 'fail'; reason: ReliabilityFailureReason }
  | { kind: 'transport'; error: unknown };

async function attemptFastWindow(
  client: OpenAIClient,
  window: TranscriptWindow,
): Promise<FastAttempt> {
  const prompt = WINDOWED_THOUGHT_EXTRACTION_PROMPT.replace('{{transcript}}', window.text);
  try {
    const { result, rawJson } = await client.completeStructuredChecked(
      [{ role: 'user', content: prompt }],
      windowExtractionSchema,
      { maxTokens: WINDOW_MAX_TOKENS, schemaName: 'thought_units' },
    );
    // ② Required field: the thoughtUnits key must exist in the RAW JSON, before
    // zod defaults fill it in — `.optional().default([])` masks its absence.
    if (
      !rawJson ||
      typeof rawJson !== 'object' ||
      Array.isArray(rawJson) ||
      !('thoughtUnits' in (rawJson as Record<string, unknown>))
    ) {
      return { kind: 'fail', reason: 'missing_field' };
    }
    // ④ Non-empty: zero thought units AND zero entities = nothing usable.
    if ((result.thoughtUnits?.length ?? 0) === 0 && (result.entities?.length ?? 0) === 0) {
      return { kind: 'fail', reason: 'empty' };
    }
    return { kind: 'pass', result: mapStructuredWindowResult(result, window) };
  } catch (error) {
    // ① parse failures and ③ truncation escape completeStructuredChecked as
    // classified errors; anything else is transport → rethrow to the caller.
    const reason = classifyCaughtError(error);
    if (reason) return { kind: 'fail', reason };
    return { kind: 'transport', error };
  }
}

/**
 * Fast-tier window extraction with four-way validation, one same-model retry,
 * and an auto-tier fallback whose result is adopted as-is. Only the fast model
 * should be routed here (isFastTierModel); the auto arm keeps the plain
 * extractFromWindow control path.
 */
export async function extractFromWindowReliable(
  client: OpenAIClient,
  window: TranscriptWindow,
  opts: {
    model: string;
    conversationId?: string;
    fallbackModel?: string;
    createFallbackClient?: () => OpenAIClient | Promise<OpenAIClient>;
    eventLogPath?: string;
  },
): Promise<WindowExtractionResult> {
  const fallbackModel = opts.fallbackModel ?? DEFAULT_FALLBACK_MODEL;
  const logPath = opts.eventLogPath ?? fallbackEventLogPath();

  const first = await attemptFastWindow(client, window);
  if (first.kind === 'pass') return first.result;
  if (first.kind === 'transport') throw first.error;

  logReliabilityEvent(
    {
      ts: new Date().toISOString(),
      windowIndex: window.index,
      conversationId: opts.conversationId,
      stage: 'retry',
      reason: first.reason,
      model: opts.model,
      fallbackModel,
    },
    logPath,
  );

  const second = await attemptFastWindow(client, window);
  if (second.kind === 'pass') return second.result;
  if (second.kind === 'transport') throw second.error;

  logReliabilityEvent(
    {
      ts: new Date().toISOString(),
      windowIndex: window.index,
      conversationId: opts.conversationId,
      stage: 'fallback',
      reason: second.reason,
      model: opts.model,
      fallbackModel,
    },
    logPath,
  );

  const fallbackClient = opts.createFallbackClient
    ? await opts.createFallbackClient()
    : await createAutoFallbackClient(fallbackModel);
  // The auto tier deliberately runs the UNRELIABLE (control) path — its result
  // is adopted as-is, mirroring how a plain auto run would extract this window.
  return extractFromWindow(fallbackClient, window);
}
