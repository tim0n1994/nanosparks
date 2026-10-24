/**
 * Windowed Extraction + Global Merge
 *
 * Per the iteration plan (Track C.2):
 * - Split transcript by speaker change / time window
 * - Per-window: extract ThoughtUnits with turnId-level evidence
 * - Global pass: semantic dedup, clustering, cross-window supports/contradicts edges
 *
 * This replaces the "整篇 transcript 一把梭" approach that caused inconsistent
 * argument granularity.
 */

import type { ThoughtUnitInput, EvidenceSpanInput, ThoughtUnitType } from '@/types/domain';
import type { OpenAIClient } from '@/lib/llm/client';
import { WINDOWED_THOUGHT_EXTRACTION_PROMPT } from '@/lib/llm/prompts/argument-extraction';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { normalizeEvidenceSpans } from './evidence-coordinates';
import { parseLenientJson } from '@/lib/llm/client';

/**
 * Per-window output budget. 8192 let every model write 4–8k tokens per window
 * (86–178 s, over the gateway's 120 s upstream cap); 3500 keeps a window
 * inside the cap, and truncation is recovered by salvageTruncatedJson instead
 * of failing the window (2026-10-19 T7).
 */
export const WINDOW_MAX_TOKENS = (() => {
  const n = parseInt(process.env.NSP_WINDOW_MAX_TOKENS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 3500;
})();

/** Minimum successful-window ratio for an analysis run to be accepted (2026-10-19). */
export function windowMinCoverage(): number {
  const v = Number(process.env.NSP_WINDOW_MIN_COVERAGE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.9;
}

// ─── Window types ──────────────────────────────────────────────

export interface TranscriptWindow {
  /** Index of this window in the sequence */
  index: number;
  /** Start time in ms */
  startMs: number;
  /** End time in ms */
  endMs: number;
  /** Turns included in this window */
  turnIndices: number[];
  sourceTurns?: TurnLike[];
  /** Sanitized text ready for LLM */
  text: string;
  /** Speaker labels present in this window */
  speakers: string[];
}

export interface WindowExtractionResult {
  windowIndex: number;
  thoughtUnits: ThoughtUnitInput[];
  /** V2/T-V2-2: candidate named entities from this window (resolved downstream). */
  entities: EntityCandidate[];
}

export interface EntityCandidate {
  surfaceForm: string;
  type: string;
  canonicalGuess: string;
}
// ─── Windowing ─────────────────────────────────────────────────

interface TurnLike {
  turnIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  participantName?: string | null;
}

/**
 * Split a transcript into windows based on speaker changes and time boundaries.
 * Each window contains a contiguous block of turns by the same speaker
 * (or a time-limited block if a speaker talks for too long).
 */
export function createWindows(
  turns: TurnLike[],
  opts: {
    maxWindowDurationMs?: number;
    maxWindowChars?: number;
    minWindows?: number;
  } = {},
): TranscriptWindow[] {
  const {
    maxWindowDurationMs = 5 * 60 * 1000, // 5 minutes
    maxWindowChars = 8000,
    minWindows = 1,
  } = opts;

  if (turns.length === 0) return [];

  const windows: TranscriptWindow[] = [];
  let currentTurns: TurnLike[] = [];
  let currentStart = turns[0].startMs;
  let currentSpeaker = turns[0].speakerLabel ?? turns[0].participantName ?? 'unknown';

  const flush = () => {
    if (currentTurns.length === 0) return;
    const text = sanitizeForPrompt(
      currentTurns
        .map((t) => {
          const speaker = t.speakerLabel ?? t.participantName ?? 'unknown';
          return `[${speaker}] (turnIndex=${t.turnIndex}, startMs=${t.startMs}, endMs=${t.endMs}) ${t.text}`;
        })
        .join('\n'),
    );
    const speakers = [...new Set(
      currentTurns.map((t) => t.speakerLabel ?? t.participantName ?? 'unknown'),
    )];
    windows.push({
      index: windows.length,
      startMs: currentStart,
      endMs: currentTurns[currentTurns.length - 1].endMs,
      turnIndices: currentTurns.map((t) => t.turnIndex),
      sourceTurns: currentTurns.map((turn) => ({ ...turn })),
      text,
      speakers,
    });
    currentTurns = [];
  };

  for (const turn of turns) {
    const speaker = turn.speakerLabel ?? turn.participantName ?? 'unknown';
    const duration = turn.endMs - currentStart;
    const textLength = currentTurns.reduce((sum, t) => sum + t.text.length, 0) + turn.text.length;

    // Split on: speaker change, max duration, max chars
    if (
      currentTurns.length > 0 &&
      (speaker !== currentSpeaker || duration > maxWindowDurationMs || textLength > maxWindowChars)
    ) {
      flush();
      currentStart = turn.startMs;
      currentSpeaker = speaker;
    }

    currentTurns.push(turn);
  }

  flush();

  // Ensure minimum windows
  if (windows.length < minWindows && turns.length > 0) {
    return createWindows(turns, {
      ...opts,
      maxWindowDurationMs: Math.floor(maxWindowDurationMs / 2),
      maxWindowChars: Math.floor(maxWindowChars / 2),
      minWindows,
    });
  }

  logger.info('Created extraction windows', {
    turns: turns.length,
    windows: windows.length,
    avgWindowChars: Math.round(
      windows.reduce((sum, w) => sum + w.text.length, 0) / Math.max(1, windows.length),
    ),
  });

  return windows;
}

// ─── Per-window extraction ─────────────────────────────────────

// Canonical ThoughtUnit types stored in the DB; reader filters on these.
const CANONICAL_TU_TYPES: ThoughtUnitType[] = ['claim', 'question', 'evidence', 'objection', 'decision', 'risk', 'insight'];
/** Map free-form model output (incl. synonyms) to the canonical type set. */
function normalizeTuType(raw: string): ThoughtUnitType {
  const t = (raw || '').toLowerCase().trim();
  if ((CANONICAL_TU_TYPES as string[]).includes(t)) return t as ThoughtUnitType;
  if (t.includes('observ') || t.includes('fact') || t.includes('statement')) return 'evidence';
  if (t.includes('conclu') || t.includes('takeaway') || t.includes('learn')) return 'insight';
  if (t.includes('idea') || t.includes('sugg')) return 'claim';
  if (t.includes('warn') || t.includes('concern')) return 'risk';
  // Default: treat unknown types as insights so they still surface in TL;DR.
  return 'insight';
}

// Exported for the fast-tier reliability layer (reliable-window.ts), which
// validates against this same schema but must ALSO see what the raw JSON did
// or did not contain before these defaults masked it.
export const windowExtractionSchema = z.object({
  thoughtUnits: z.array(
    z.object({
      // Accept any string and normalize: models sometimes emit synonyms
      // (e.g. "observation", "fact") that aren't in the enum. Mapping keeps the
      // extraction instead of dropping the whole window.
      type: z.string(),
      text: z.string(),
      confidence: z.number().optional().default(0.7),
      // V1/T-V1-2: speaker label copied verbatim from the window's [标签] marker,
      // resolved to a Participant.id downstream by resolveParticipant().
      speakerLabel: z.string().optional(),
      stance: z.string().optional(),
      evidenceSpans: z.array(
        z.object({
          turnIndex: z.number().optional(),
          startMs: z.number().optional(),
          endMs: z.number().optional(),
          quote: z.string(),
        }),
      ).default([]),
    }),
  ).optional().default([]),
  // V2/T-V2-2: top-level candidate entities (folded into the same call).
  entities: z
    .array(
      z.object({
        surfaceForm: z.string(),
        type: z.string(),
        canonicalGuess: z.string(),
      }),
    )
    .optional()
    .default([]),
});

/**
 * Map a structured windowExtractionSchema result to the domain shape: canonical
 * TU types, speakerLabel → participantLabel rename, evidence coordinate
 * normalization. Shared by extractFromWindow and the fast-tier reliability
 * layer (reliable-window.ts) so both produce identical results.
 */
export function mapStructuredWindowResult(
  result: z.infer<typeof windowExtractionSchema>,
  window: TranscriptWindow,
): WindowExtractionResult {
  const thoughtUnits = result.thoughtUnits ?? [];
  // Normalize type to the canonical set so reader filters
  // (type in ['insight','decision']) keep working for model synonyms.
  for (const tu of thoughtUnits) {
    tu.type = normalizeTuType(tu.type);
  }
  // V1/T-V1-2: rename the model's `speakerLabel` to the domain `participantLabel`
  // so analyze.ts can resolve it to a Participant.id. Keep stance as-is.
  const mapped: ThoughtUnitInput[] = thoughtUnits.map((tu) => {
    const { speakerLabel, stance, ...rest } = tu as Record<string, unknown>;
    return {
      ...rest,
      participantLabel: typeof speakerLabel === 'string' ? speakerLabel : undefined,
      stance: typeof stance === 'string' ? stance : undefined,
    } as unknown as ThoughtUnitInput;
  });
  if (thoughtUnits.length === 0) {
    logger.warn('Window extraction returned no thoughtUnits', { windowIndex: window.index });
  }
  return {
    windowIndex: window.index,
    thoughtUnits: mapped.map((tu) => ({ ...tu, evidenceSpans: normalizeEvidenceSpans(tu.evidenceSpans, window.sourceTurns ?? []) })),
    entities: (result.entities ?? []) as EntityCandidate[],
  };
}

/**
 * Extract ThoughtUnits from a single window using structured output.
 */
export async function extractFromWindow(
  client: OpenAIClient,
  window: TranscriptWindow,
): Promise<WindowExtractionResult> {
  const prompt = WINDOWED_THOUGHT_EXTRACTION_PROMPT.replace('{{transcript}}', window.text);

  try {
    const result = await client.completeStructured(
      [{ role: 'user', content: prompt }],
      windowExtractionSchema,
      { maxTokens: WINDOW_MAX_TOKENS, schemaName: 'thought_units' },
    );

    return mapStructuredWindowResult(result, window);
  } catch (error) {
    // Distinguish "model returned no TUs" from a genuine transport/parse failure.
    // Missing-key / empty results no longer throw (the schema defaults to []),
    // so reaching here means a real error worth a single unstructured retry.
    logger.warn('Window extraction failed, falling back to unstructured', {
      windowIndex: window.index,
      error: String(error),
    });

    // Fallback: use the old prompt-based approach
    const response = await client.completeWithRetry(
      [{ role: 'user', content: prompt }],
      WINDOW_MAX_TOKENS,
      3,
    );

    // parseLenientJson (not raw JSON.parse): the fallback prompt has no schema
    // enforcement, so fences/prose/truncation are routine here (2026-10-19).
    const parsed = parseLenientJson(response.content, 'thought_units_fallback');
    const validated = windowExtractionSchema.parse(Array.isArray(parsed) ? { thoughtUnits: parsed } : parsed);
    return {
      windowIndex: window.index,
      thoughtUnits: validated.thoughtUnits.map(({ speakerLabel, ...tu }) => ({
        ...tu,
        type: normalizeTuType(tu.type),
        participantLabel: speakerLabel,
        evidenceSpans: normalizeEvidenceSpans(tu.evidenceSpans, window.sourceTurns ?? []),
      })) as ThoughtUnitInput[],
      entities: validated.entities,
    };
  }
}

// ─── Global merge ──────────────────────────────────────────────

export interface MergedThoughtUnit extends ThoughtUnitInput {
  /** Source windows that contributed to this TU */
  sourceWindows: number[];
  /** Cluster ID for semantically similar TUs */
  clusterId?: string;
}

export interface MergedExtractionResult {
  thoughtUnits: MergedThoughtUnit[];
  /** Cross-window relations: supports/contradicts between TUs */
  relations: Array<{
    sourceText: string;
    targetText: string;
    relation: 'supports' | 'contradicts' | 'refines';
    confidence: number;
  }>;
}

/**
 * Global merge pass: deduplicate, cluster, and find cross-window relations.
 *
 * Dedup: exact text match (case-insensitive) → keep highest confidence.
 * Clustering: group by type + text similarity (substring/Jaccard).
 * Relations: detect supports/contradicts by keyword heuristics.
 */
export function mergeExtractions(
  windowResults: WindowExtractionResult[],
): MergedExtractionResult {
  const allTUs: Array<ThoughtUnitInput & { windowIndex: number }> = [];

  for (const result of windowResults) {
    for (const tu of result.thoughtUnits) {
      allTUs.push({ ...tu, windowIndex: result.windowIndex });
    }
  }

  // ── Dedup by normalized text ──
  const seen = new Map<string, MergedThoughtUnit>();
  for (const tu of allTUs) {
    const key = tu.text.toLowerCase().trim().slice(0, 200);
    const existing = seen.get(key);
    if (existing) {
      // Keep the one with higher confidence
      if (tu.confidence > (existing.confidence ?? 0)) {
        existing.text = tu.text;
        existing.confidence = tu.confidence;
        existing.evidenceSpans = [...existing.evidenceSpans, ...tu.evidenceSpans];
      }
      existing.sourceWindows.push(tu.windowIndex);
    } else {
      seen.set(key, {
        ...tu,
        sourceWindows: [tu.windowIndex],
      });
    }
  }

  const thoughtUnits = [...seen.values()];

  // ── Cluster by type + text similarity ──
  const clusters = new Map<string, string[]>();
  for (const tu of thoughtUnits) {
    const clusterKey = `${tu.type}:${tu.text.toLowerCase().slice(0, 50)}`;
    if (!clusters.has(clusterKey)) {
      clusters.set(clusterKey, []);
    }
    clusters.get(clusterKey)!.push(tu.text);
  }

  // Assign cluster IDs
  let clusterIdx = 0;
  const clusterMap = new Map<string, string>();
  for (const [key] of clusters) {
    clusterMap.set(key, `cluster_${clusterIdx++}`);
  }
  for (const tu of thoughtUnits) {
    const clusterKey = `${tu.type}:${tu.text.toLowerCase().slice(0, 50)}`;
    tu.clusterId = clusterMap.get(clusterKey);
  }

  // ── Cross-window relations ──
  // Simple heuristic: if two TUs from different windows have same type and
  // one contains a negation of the other, mark as contradicts.
  const relations: MergedExtractionResult['relations'] = [];
  const claims = thoughtUnits.filter((tu) => tu.type === 'claim');

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];
      if (a.sourceWindows.some((w) => b.sourceWindows.includes(w))) continue;

      // Check for negation overlap
      const aWords = new Set(a.text.toLowerCase().split(/\s+/));
      const bWords = new Set(b.text.toLowerCase().split(/\s+/));
      const intersection = [...aWords].filter((w) => bWords.has(w)).length;
      const union = aWords.size + bWords.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard > 0.3) {
        const hasNegation = /\b(not|no|never|don't|doesn't|isn't|aren't|won't|can't|不|没有|不是|并非|无)\b/i.test(
          a.text + ' ' + b.text,
        );
        relations.push({
          sourceText: a.text,
          targetText: b.text,
          relation: hasNegation ? 'contradicts' : 'supports',
          confidence: jaccard,
        });
      }
    }
  }

  logger.info('Merged extraction results', {
    inputTUs: allTUs.length,
    dedupedTUs: thoughtUnits.length,
    clusters: clusters.size,
    relations: relations.length,
  });

  return { thoughtUnits, relations };
}
