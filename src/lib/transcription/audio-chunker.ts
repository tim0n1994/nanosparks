/**
 * Audio chunker for Paraformer >2h limit (PRD §A2: 超长用现有 chunker 切片分段提交再拼接).
 *
 * Paraformer recommends ≤2h per file with diarization. For longer audio, we
 * split into ≤2h chunks with an overlap window (for cross-chunk speaker
 * alignment via speaker-realignment.ts). This module handles the splitting
 * logic + ffprobe duration detection + ffmpeg execution.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

/** Max chunk duration for Paraformer with diarization (PRD: ≤2h). */
export const MAX_CHUNK_SEC = 2 * 3600; // 7200s
/** Overlap between chunks for cross-chunk speaker alignment (PRD: 重叠窗口). */
export const CHUNK_OVERLAP_SEC = 60; // 1 min overlap

export interface AudioChunk {
  index: number;
  path: string;
  startSec: number;
  endSec: number;
  /** Offset to add to timestamps from this chunk to get absolute time. */
  timeOffsetMs: number;
}

/** Get audio duration in seconds via ffprobe. Returns null if ffprobe unavailable. */
export async function getAudioDurationSec(filePath: string): Promise<number | null> {
  if (!existsSync(filePath)) return null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
    ], { timeout: 30_000 });
    const data = JSON.parse(stdout) as { format?: { duration?: string } };
    const dur = parseFloat(data.format?.duration ?? '0');
    return dur > 0 ? dur : null;
  } catch {
    logger.warn('ffprobe failed — duration unknown, treating as single chunk');
    return null;
  }
}

/** Decide whether audio needs chunking (duration > MAX_CHUNK_SEC). Pure logic. */
export function needsChunking(durationSec: number | null): boolean {
  return durationSec !== null && durationSec > MAX_CHUNK_SEC;
}

/** Compute chunk boundaries for a given duration. Pure logic — testable. */
export function planChunks(durationSec: number): Array<{ startSec: number; endSec: number; index: number }> {
  if (durationSec <= MAX_CHUNK_SEC) {
    return [{ startSec: 0, endSec: durationSec, index: 0 }];
  }

  const chunks: Array<{ startSec: number; endSec: number; index: number }> = [];
  let start = 0;
  let index = 0;

  while (start < durationSec) {
    const end = Math.min(start + MAX_CHUNK_SEC, durationSec);
    chunks.push({ startSec: start, endSec: end, index });
    // Next chunk starts CHUNK_OVERLAP_SEC before this one ends (for speaker alignment).
    start = end - CHUNK_OVERLAP_SEC;
    index++;
    // Safety: if the overlap makes start not advance, break.
    if (start <= chunks[chunks.length - 1].startSec) break;
  }

  return chunks;
}

/** Split an audio file into chunks via ffmpeg. Returns chunk file paths + metadata. */
export async function splitAudioIntoChunks(
  filePath: string,
  durationSec: number,
  outputDir: string,
): Promise<AudioChunk[]> {
  const plan = planChunks(durationSec);
  if (plan.length <= 1) {
    return [{ index: 0, path: filePath, startSec: 0, endSec: durationSec, timeOffsetMs: 0 }];
  }

  const baseName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'audio';
  const chunks: AudioChunk[] = [];

  for (const c of plan) {
    const chunkPath = `${outputDir}/${baseName}_chunk${c.index}.mp3`;
    const duration = c.endSec - c.startSec;

    if (existsSync(chunkPath)) {
      logger.info('Chunk already exists, skipping ffmpeg', { chunkPath });
    } else {
      await execFileAsync('ffmpeg', [
        '-i', filePath,
        '-ss', String(c.startSec),
        '-t', String(duration),
        '-acodec', 'libmp3lame', '-ab', '128k',
        '-y', chunkPath,
      ], { timeout: 300_000 });
    }

    chunks.push({
      index: c.index,
      path: chunkPath,
      startSec: c.startSec,
      endSec: c.endSec,
      timeOffsetMs: Math.round(c.startSec * 1000),
    });
  }

  logger.info('Audio split into chunks', { total: chunks.length, durationSec });
  return chunks;
}

/** Adjust timestamps in a transcription result by adding the chunk's time offset. Pure logic. */
export function offsetTimestamps(
  segments: Array<{ startMs: number; endMs: number; text: string; speakerLabel?: string; words?: unknown[] }>,
  offsetMs: number,
): Array<{ startMs: number; endMs: number; text: string; speakerLabel?: string; words?: unknown[] }> {
  return segments.map((s) => ({
    ...s,
    startMs: s.startMs + offsetMs,
    endMs: s.endMs + offsetMs,
    words: s.words ? (s.words as Array<{ startMs: number; endMs: number }>).map((w) => ({
      ...w,
      startMs: w.startMs + offsetMs,
      endMs: w.endMs + offsetMs,
    })) : undefined,
  }));
}
