/**
 * QwenAsrProvider — Qwen3-ASR via mlx-qwen3-asr CLI subprocess (PRD §A2 R3 local).
 *
 * Uses the CLI (`mlx-qwen3-asr audio.mp3 -f json --stdout-only --timestamps`)
 * as a subprocess instead of the HTTP server. The server's asyncio.to_thread
 * offload breaks MLX GPU streams across threads ("no Stream(gpu, 1)"); a
 * single-process CLI invocation has no threading issue.
 *
 * The CLI binary lives in a dedicated venv (~/qwen-asr-env/bin/mlx-qwen3-asr).
 * Output is JSON on stdout; progress goes to stderr (ignored).
 */

import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment } from '@/types/domain';
import { logger } from '@/lib/logger';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_PATH = process.env.QWEN_ASR_CLI || `${process.env.HOME}/qwen-asr-env/bin/mlx-qwen3-asr`;
// 8h audio at ~2x realtime = 4h; generous ceiling.
const CLI_TIMEOUT_MS = 6 * 60 * 60 * 1000;

interface QwenSegment {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
}

interface QwenJsonResult {
  text?: string;
  language?: string;
  duration?: number;
  segments?: QwenSegment[];
}

export class QwenAsrProvider implements TranscriptionProvider {
  getProviderName(): string { return 'qwen-asr'; }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const { mediaPath, language } = input;
    if (!mediaPath || !existsSync(mediaPath)) {
      throw new Error(`QwenAsrProvider: media file not found: ${mediaPath}`);
    }

    logger.info('QwenAsr CLI starting', { mediaPath, cli: CLI_PATH });

    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `QwenAsrProvider: mlx-qwen3-asr CLI not found at ${CLI_PATH}. ` +
          'Install with: pip install "mlx-qwen3-asr[serve,diarize]"',
      );
    }

    const args = [
      mediaPath,
      '-f', 'json',
      '--stdout-only',
      '--timestamps',
    ];
    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    const { stdout } = await execFileAsync(CLI_PATH, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 100 * 1024 * 1024, // 100MB — long transcripts can be large JSON
      env: {
        ...process.env,
        // HF token for model download (cached after first run) + pyannote diarization.
        HF_TOKEN: process.env.HF_TOKEN || process.env.PYANNOTE_AUTH_TOKEN || '',
        PYANNOTE_AUTH_TOKEN: process.env.PYANNOTE_AUTH_TOKEN || '',
      },
    });

    const result = JSON.parse(stdout) as QwenJsonResult;
    logger.info('QwenAsr CLI completed', {
      segments: result.segments?.length ?? 0,
      language: result.language,
      duration: result.duration,
    });

    return this.normalizeResult(result, language);
  }

  private normalizeResult(result: QwenJsonResult, language?: string): TranscriptionResult {
    let rawSegments: TranscriptSegment[] = (result.segments ?? []).map((seg) => ({
      startMs: Math.round((seg.start ?? 0) * 1000),
      endMs: Math.round((seg.end ?? 0) * 1000),
      text: (seg.text ?? '').trim(),
      speakerLabel: seg.speaker,
    }));

    // Qwen3-ASR sometimes emits word/char-level segments (avg < 4 chars).
    // Merge them into sentence-level turns for the reader.
    if (needsMerging(rawSegments)) {
      rawSegments = mergeWordSegments(rawSegments);
    }

    return {
      segments: rawSegments,
      language: result.language ?? language,
      durationMs: result.duration ? Math.round(result.duration * 1000) : undefined,
      provider: 'qwen-asr',
    };
  }
}

/** Detect per-word/per-character granularity (avg text < 4 chars, many segments). */
function needsMerging(segs: TranscriptSegment[]): boolean {
  if (segs.length < 20) return false;
  const avgLen = segs.reduce((n, s) => n + s.text.length, 0) / segs.length;
  return avgLen < 4;
}

/**
 * Merge word/char-level segments into sentence-level turns.
 * Breaks on: sentence-ending punctuation, silence gaps > 1200ms, or length > 60 chars.
 */
function mergeWordSegments(segs: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let buf: TranscriptSegment[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.map((s) => s.text).join('');
    if (text.trim()) {
      merged.push({
        startMs: buf[0].startMs,
        endMs: buf[buf.length - 1].endMs,
        text: text.trim(),
        speakerLabel: buf[0].speakerLabel,
      });
    }
    buf = [];
  };

  for (const seg of segs) {
    buf.push(seg);
    const text = buf.map((s) => s.text).join('');
    const lastEnd = buf[buf.length - 1].endMs;
    const gap = seg.startMs - lastEnd;
    if (text.length >= 60 || gap > 1200 || /[。！？.!?\n]$/.test(seg.text)) {
      flush();
    }
  }
  flush();
  return merged;
}
