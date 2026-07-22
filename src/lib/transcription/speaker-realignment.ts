/**
 * Cross-chunk speaker realignment (PRD §A2/§11 risk mitigation).
 *
 * When an episode exceeds the Paraformer ≤2h single-file limit we slice it and
 * transcribe each chunk separately. Each chunk's speaker_id labels are LOCAL to
 * that chunk (chunk-2's speaker_0 may be a different human than chunk-1's
 * speaker_0). This module re-aligns labels across chunks so the merged transcript
 * has globally-consistent speaker identities.
 *
 * Strategy (PRD: 重叠窗口声纹 or LLM 说话人映射兜底):
 *   1) Overlap-window matching — chunks transcribed with overlapping tails let
 *      us match a local label to a global label by co-occurrence in the overlap.
 *   2) LLM fallback — when there is no overlap, hand the per-chunk speaker
 *      turn-patterns to an LLM and ask it to propose a global mapping.
 */

import type { TranscriptSegment } from '@/types/domain';

type LocalLabel = string;
type GlobalLabel = string;

export interface ChunkOverlap {
  chunkIndex: number;
  segments: TranscriptSegment[];
}

export interface SpeakerMap {
  [chunkIndex: number]: Record<LocalLabel, GlobalLabel>;
}

let counter = 0;
function globalCounter(): number {
  return counter++;
}

/** Reset the internal global-speaker counter (for deterministic tests). */
export function resetGlobalCounter(): void {
  counter = 0;
}

/**
 * Build a global speaker map from per-chunk overlap windows. Chunk 0 is the
 * reference (its labels pass through); each subsequent chunk's local labels are
 * mapped to global labels via co-occurrence in the overlap with the prior chunk.
 */
export function buildSpeakerMapFromOverlaps(
  overlaps: ChunkOverlap[],
  opts: { timeToleranceMs?: number } = {},
): SpeakerMap {
  const tolerance = opts.timeToleranceMs ?? 1000;
  const map: SpeakerMap = { 0: {} };

  for (let i = 0; i < overlaps.length - 1; i++) {
    const current = overlaps[i];
    const next = overlaps[i + 1];
    if (current.chunkIndex !== next.chunkIndex - 1) continue;

    const pairs = matchOverlapSegments(current.segments, next.segments, tolerance);
    const chunkMap = map[current.chunkIndex] ?? {};
    const nextMap: Record<LocalLabel, GlobalLabel> = {};

    for (const { aLabel, bLabel } of pairs) {
      const globalName = chunkMap[aLabel] ?? aLabel;
      nextMap[bLabel] = globalName;
    }

    // Unmatched next-chunk labels become new global speakers.
    const allNextLabels = new Set(next.segments.map((s) => s.speakerLabel ?? 'unknown'));
    for (const lbl of allNextLabels) {
      if (!(lbl in nextMap)) {
        nextMap[lbl] = `speaker_g_${globalCounter()}`;
      }
    }

    map[next.chunkIndex] = nextMap;
  }

  return map;
}

/** Match segments across two overlap windows by midpoint proximity. */
function matchOverlapSegments(
  a: TranscriptSegment[],
  b: TranscriptSegment[],
  toleranceMs: number,
): Array<{ aLabel: string; bLabel: string }> {
  const pairs: Array<{ aLabel: string; bLabel: string }> = [];
  for (const segA of a) {
    const midA = (segA.startMs + segA.endMs) / 2;
    let best: TranscriptSegment | null = null;
    let bestDist = Infinity;
    for (const segB of b) {
      const midB = (segB.startMs + segB.endMs) / 2;
      const dist = Math.abs(midA - midB);
      if (dist < bestDist) {
        bestDist = dist;
        best = segB;
      }
    }
    if (best && bestDist <= toleranceMs) {
      pairs.push({ aLabel: segA.speakerLabel ?? 'unknown', bLabel: best.speakerLabel ?? 'unknown' });
    }
  }
  return pairs;
}

/** Apply a speaker map to a chunk's segments, returning relabeled segments. */
export function relabelChunk(
  segments: TranscriptSegment[],
  chunkMap: Record<LocalLabel, GlobalLabel>,
): TranscriptSegment[] {
  if (!chunkMap || Object.keys(chunkMap).length === 0) return segments;
  return segments.map((s) => ({
    ...s,
    speakerLabel: chunkMap[s.speakerLabel ?? 'unknown'] ?? s.speakerLabel,
  }));
}

// ── LLM fallback (PRD §A2/§11: LLM 说话人映射兜底) ──
// Used when there is no overlap window between chunks. We hand each chunk's
// per-speaker turn-patterns (opening lines) to an LLM and ask it to propose a
// global speaker mapping by matching who-says-what across chunks.

import type { OpenAIClient } from '@/lib/llm/client';
import { logger } from '@/lib/logger';

/** A per-chunk summary of what each local speaker said (their opening line). */
export interface ChunkSpeakerProfile {
  chunkIndex: number;
  /** localLabel -> first utterance (signature line for matching). */
  speakers: Record<string, string>;
}

/** Build the LLM prompt describing each chunk's speakers and their opening lines. */
export function buildSpeakerMappingPrompt(profiles: ChunkSpeakerProfile[]): string {
  const body = profiles
    .map((p) =>
      Object.entries(p.speakers)
        .map(([label, line]) => `chunk${p.chunkIndex}:${label}\t${line}`)
        .join('\n'),
    )
    .join('\n');
  return [
    '下面是同一集播客被切成多段分别转写后，每段里每个说话人（local label）的首句发言。',
    '同一个人在不同段里可能是不同的 local label。请判断哪些 local label 是同一个真实说话人，给出全局映射。',
    '严格只输出 JSON：{"mappings": [{"chunkIndex": number, "local": "speaker_X", "global": "speaker_0"}]}。',
    '无法确定的不要强行合并，给每个不确定的 local label 分配独立的全局编号。',
    '',
    body,
  ].join('\n');
}

/** Parse the LLM speaker-mapping JSON response (tolerant of code fences). */
export function parseSpeakerMappingResponse(raw: string): SpeakerMap {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < 0) return {};
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as {
      mappings?: Array<{ chunkIndex: number; local: string; global: string }>;
    };
    const map: SpeakerMap = {};
    for (const m of parsed.mappings ?? []) {
      if (!map[m.chunkIndex]) map[m.chunkIndex] = {};
      map[m.chunkIndex][m.local] = m.global;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * LLM-fallback speaker realignment. Builds per-chunk profiles from the chunks'
 * first utterances, asks the LLM to map locals→globals, and returns a SpeakerMap.
 * Best-effort: on failure returns an empty map (caller keeps local labels).
 */
export async function buildSpeakerMapWithLLM(
  chunks: TranscriptSegment[][],
  client: OpenAIClient,
): Promise<SpeakerMap> {
  // Build a profile per chunk: first utterance per local speaker.
  const profiles: ChunkSpeakerProfile[] = chunks.map((segments, chunkIndex) => {
    const speakers: Record<string, string> = {};
    for (const s of segments) {
      const label = s.speakerLabel ?? 'unknown';
      if (!(label in speakers)) {
        speakers[label] = s.text.slice(0, 80);
      }
    }
    return { chunkIndex, speakers };
  });

  // Chunk 0 is the reference: its labels pass through.
  const map: SpeakerMap = { 0: {} };
  if (profiles.length <= 1) return map;

  try {
    const resp = await client.completeWithRetry(
      [{ role: 'user', content: buildSpeakerMappingPrompt(profiles) }],
      2000,
      2,
      true,
    );
    const llmMap = parseSpeakerMappingResponse(resp.content);
    // Merge LLM mappings, ensuring chunk 0 stays identity.
    for (const [k, v] of Object.entries(llmMap)) {
      const idx = Number(k);
      if (idx === 0) continue;
      map[idx] = v;
    }
    logger.info('LLM speaker mapping built', { chunks: chunks.length, mapped: Object.keys(map).length });
  } catch (err) {
    logger.warn('LLM speaker mapping failed, keeping local labels', { error: String(err) });
  }

  return map;
}
