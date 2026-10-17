/**
 * QwenAsrProvider — Qwen3-ASR via mlx-qwen3-asr CLI subprocess (PRD §A2 R3 local).
 *
 * Uses the CLI (`mlx-qwen3-asr audio.mp3 -f json --output-dir <temp> --timestamps`)
 * as a subprocess instead of the HTTP server. The server's asyncio.to_thread
 * offload breaks MLX GPU streams across threads ("no Stream(gpu, 1)"); a
 * single-process CLI invocation has no threading issue.
 *
 * The CLI binary lives in a dedicated venv (~/qwen-asr-env/bin/mlx-qwen3-asr).
 * The CLI prints plain text on stdout and writes structured JSON to a file.
 */

import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment } from '@/types/domain';
import { logger } from '@/lib/logger';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
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
  chunks?: QwenSegment[];
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

    const outputDir = await mkdtemp(join(tmpdir(), 'nanosparks-qwen-asr-'));
    const args = [
      mediaPath,
      '-f', 'json',
      '--output-dir', outputDir,
      '--timestamps',
    ];
    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    try {
      await execFileAsync(CLI_PATH, args, {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 100 * 1024 * 1024,
        env: {
          ...process.env,
          HF_TOKEN: process.env.HF_TOKEN || process.env.PYANNOTE_AUTH_TOKEN || '',
          PYANNOTE_AUTH_TOKEN: process.env.PYANNOTE_AUTH_TOKEN || '',
        },
      });

      const outputPath = join(outputDir, `${parse(mediaPath).name}.json`);
      const result = JSON.parse(await readFile(outputPath, 'utf8')) as QwenJsonResult;
      const normalized = this.normalizeResult(result, language);
      logger.info('QwenAsr CLI completed', {
        segments: normalized.segments.length,
        language: normalized.language,
        durationMs: normalized.durationMs,
      });

      return normalized;
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  private normalizeResult(result: QwenJsonResult, language?: string): TranscriptionResult {
    const sourceSegments = result.segments?.length ? result.segments : (result.chunks ?? []);
    let rawSegments: TranscriptSegment[] = sourceSegments.map((seg) => ({
      startMs: Math.round((seg.start ?? 0) * 1000),
      endMs: Math.round((seg.end ?? 0) * 1000),
      text: (seg.text ?? '').trim(),
      speakerLabel: seg.speaker,
    }));

    if (result.segments?.length && needsMerging(rawSegments)) {
      rawSegments = mergeWordSegments(rawSegments, result.language ?? language);
    }

    // The installed JSON writer omits duration; chunks retain the audio bounds.
    const endTimes = [result.duration, ...(result.chunks ?? sourceSegments).map(seg => seg.end)]
      .filter((end): end is number => typeof end === 'number' && Number.isFinite(end) && end >= 0);
    return {
      segments: rawSegments,
      language: result.language ?? language,
      durationMs: endTimes.length ? Math.round(endTimes.reduce((max, end) => Math.max(max, end), 0) * 1000) : undefined,
      provider: 'qwen-asr',
    };
  }
}

function needsMerging(segs: TranscriptSegment[]): boolean {
  return segs.length > 1 && segs.every(({ text }) => {
    const cjkCharacters = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
    return text.length > 0 && !/\s/u.test(text) && (cjkCharacters?.length ?? 0) <= 2;
  });
}

function mergeWordSegments(segs: TranscriptSegment[], language?: string): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let buf: TranscriptSegment[] = [];
  const cjkLanguage = /^(chinese|zh(?:-.+)?|cantonese|yue|japanese|ja|jp)$/i.test(language ?? '');
  const joinedText = (segments: TranscriptSegment[]) => segments.reduce((text, segment, index) => {
    const previous = segments[index - 1];
    const latinWordPair = previous && /[A-Za-z0-9]/u.test(previous.text) && /[A-Za-z0-9]/u.test(segment.text);
    const separator = previous && (!cjkLanguage || latinWordPair) ? ' ' : '';
    return text + separator + segment.text;
  }, '')
    .replace(/\s+([,.;:!?。！？，、])/gu, '$1')
    .replace(/([(\[{])\s+/gu, '$1');

  const flush = () => {
    if (buf.length === 0) return;
    const text = joinedText(buf);
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
    const previous = buf.at(-1);
    if (previous && (
      seg.startMs - previous.endMs > 1200 ||
      seg.speakerLabel !== previous.speakerLabel ||
      joinedText([...buf, seg]).length > 60
    )) flush();
    buf.push(seg);
    if (/[。！？.!?\n]$/.test(seg.text)) {
      flush();
    }
  }
  flush();
  return merged;
}
