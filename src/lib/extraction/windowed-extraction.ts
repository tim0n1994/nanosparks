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

import type { ThoughtUnitInput, EvidenceSpanInput } from '@/types/domain';
import type { OpenAIClient } from '@/lib/llm/client';
import { ARGUMENT_EXTRACTION_PROMPT } from '@/lib/llm/prompts/argument-extraction';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { logger } from '@/lib/logger';
import { z } from 'zod';

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
  /** Sanitized text ready for LLM */
  text: string;
  /** Speaker labels present in this window */
  speakers: string[];
}

export interface WindowExtractionResult {
  windowIndex: number;
  thoughtUnits: ThoughtUnitInput[];
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
          return `[${speaker}] ${t.text}`;
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

const windowExtractionSchema = z.object({
  thoughtUnits: z.array(
    z.object({
      type: z.enum(['claim', 'question', 'evidence', 'objection', 'decision', 'risk', 'insight']),
      text: z.string(),
      confidence: z.number(),
      evidenceSpans: z.array(
        z.object({
          turnIndex: z.number().optional(),
          startMs: z.number(),
          endMs: z.number(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

/**
 * Extract ThoughtUnits from a single window using structured output.
 */
export async function extractFromWindow(
  client: OpenAIClient,
  window: TranscriptWindow,
): Promise<WindowExtractionResult> {
  const prompt = ARGUMENT_EXTRACTION_PROMPT.replace('{{transcript}}', window.text);

  try {
    const result = await client.completeStructured(
      [{ role: 'user', content: prompt }],
      windowExtractionSchema,
      { maxTokens: 4096, schemaName: 'thought_units' },
    );

    return {
      windowIndex: window.index,
      thoughtUnits: result.thoughtUnits,
    };
  } catch (error) {
    logger.warn('Window extraction failed, falling back to unstructured', {
      windowIndex: window.index,
      error: String(error),
    });

    // Fallback: use the old prompt-based approach
    const response = await client.completeWithRetry(
      [{ role: 'user', content: prompt }],
      4096,
      3,
    );

    try {
      const parsed = JSON.parse(response.content);
      const thoughtUnits = Array.isArray(parsed) ? parsed : (parsed.thoughtUnits ?? []);
      return {
        windowIndex: window.index,
        thoughtUnits: thoughtUnits as ThoughtUnitInput[],
      };
    } catch {
      return { windowIndex: window.index, thoughtUnits: [] };
    }
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
