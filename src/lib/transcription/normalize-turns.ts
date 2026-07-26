/**
 * Normalize Turns
 *
 * Merges ASR word sequences with diarization speaker segments to produce
 * NormalizedTurns — continuous speech by a single speaker.
 *
 * Algorithm:
 * 1. Flatten ASR segments into a word timeline (if word timestamps available).
 * 2. For each word, assign the speaker whose diarization segment overlaps
 *    the word's midpoint (exclusive mode: pick the single most likely speaker).
 * 3. Group consecutive words by speaker into turns.
 * 4. If no word timestamps, fall back to segment-level assignment by overlap.
 *
 * This is the "glue" between transcribe (what was said) and diarize (who said it).
 */

import type {
  TranscriptSegment,
  SpeakerSegment,
  NormalizedTurn,
  WordTimestamp,
} from '@/types/domain';
import { logger } from '@/lib/logger';

interface NormalizeOptions {
  /** Minimum gap (ms) between same-speaker segments to split into separate turns */
  minTurnGapMs?: number;
  /** Maximum turn duration (ms) — longer turns are split for processing */
  maxTurnDurationMs?: number;
}

/**
 * Assign a speaker label to a timestamp by finding the overlapping diarization segment.
 * Exclusive mode: picks the single segment with the most overlap.
 */
export function assignSpeaker(
  startMs: number,
  endMs: number,
  speakerSegments: SpeakerSegment[],
): string | undefined {
  const midMs = (startMs + endMs) / 2;

  let bestLabel: string | undefined;
  let bestOverlap = 0;

  for (const seg of speakerSegments) {
    // Calculate overlap between [startMs, endMs] and [seg.startMs, seg.endMs]
    const overlapStart = Math.max(startMs, seg.startMs);
    const overlapEnd = Math.min(endMs, seg.endMs);
    const overlap = overlapEnd - overlapStart;

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLabel = seg.label;
    }
  }

  // If no overlap but midpoint falls within a segment, use that
  if (!bestLabel) {
    for (const seg of speakerSegments) {
      if (midMs >= seg.startMs && midMs <= seg.endMs) {
        bestLabel = seg.label;
        break;
      }
    }
  }

  return bestLabel;
}

/**
 * Extract a word timeline from transcript segments.
 * Uses word-level timestamps when available, otherwise creates pseudo-words
 * by splitting text on whitespace.
 */
function buildWordTimeline(segments: TranscriptSegment[]): WordTimestamp[] {
  const words: WordTimestamp[] = [];

  for (const seg of segments) {
    if (seg.words && seg.words.length > 0) {
      words.push(...seg.words);
    } else {
      // Fallback: split text into pseudo-words with evenly distributed timestamps
      const tokens = seg.text.split(/\s+/).filter((w) => w.length > 0);
      const duration = seg.endMs - seg.startMs;
      const perWord = tokens.length > 0 ? duration / tokens.length : 0;

      tokens.forEach((word, i) => {
        words.push({
          word,
          startMs: Math.round(seg.startMs + i * perWord),
          endMs: Math.round(seg.startMs + (i + 1) * perWord),
        });
      });
    }
  }

  return words;
}

/**
 * Merge ASR transcript segments with diarization speaker segments
 * to produce continuous per-speaker turns.
 */
export function normalizeTurns(
  asrSegments: TranscriptSegment[],
  diarization: { segments: SpeakerSegment[]; speakerCount: number },
  opts: NormalizeOptions = {},
): NormalizedTurn[] {
  const { minTurnGapMs = 1000, maxTurnDurationMs = 60_000 } = opts;

  if (asrSegments.length === 0) {
    return [];
  }

  // If no diarization available, return a single "SPEAKER_00" turn per ASR segment
  if (diarization.segments.length === 0 || diarization.speakerCount === 0) {
    logger.warn('No diarization data, assigning all segments to SPEAKER_00');
    return asrSegments.map((seg) => ({
      speakerLabel: 'SPEAKER_00',
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text,
      words: seg.words,
      confidence: seg.confidence ?? 1.0,
    }));
  }

  // Build word timeline and assign speakers
  const words = buildWordTimeline(asrSegments);

  // Assign each word a speaker
  const wordsWithSpeaker = words.map((w) => ({
    ...w,
    speakerLabel: assignSpeaker(w.startMs, w.endMs, diarization.segments) ?? 'SPEAKER_00',
  }));

  // Group consecutive words by speaker into turns
  const turns: NormalizedTurn[] = [];
  let currentTurn: NormalizedTurn | null = null;

  for (const word of wordsWithSpeaker) {
    if (
      currentTurn &&
      currentTurn.speakerLabel === word.speakerLabel &&
      word.startMs - currentTurn.endMs < minTurnGapMs &&
      word.endMs - currentTurn.startMs < maxTurnDurationMs
    ) {
      // Extend current turn
      currentTurn.endMs = word.endMs;
      currentTurn.text = currentTurn.text
        ? `${currentTurn.text} ${word.word}`
        : word.word;
      currentTurn.words?.push({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
      });
    } else {
      // Start new turn
      if (currentTurn) {
        turns.push(currentTurn);
      }
      currentTurn = {
        speakerLabel: word.speakerLabel,
        startMs: word.startMs,
        endMs: word.endMs,
        text: word.word,
        words: [{
          word: word.word,
          startMs: word.startMs,
          endMs: word.endMs,
        }],
        confidence: 1.0,
      };
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  // Clean up text (trim, collapse multiple spaces)
  for (const turn of turns) {
    turn.text = turn.text.replace(/\s+/g, ' ').trim();
  }

  logger.info('Normalized turns', {
    asrSegments: asrSegments.length,
    diarizationSegments: diarization.segments.length,
    outputTurns: turns.length,
    speakers: new Set(turns.map((t) => t.speakerLabel)).size,
  });

  return turns;
}
