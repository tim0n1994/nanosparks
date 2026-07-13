/**
 * LocalWhisperProvider
 *
 * Implements TranscriptionProvider using local Whisper (or WhisperX).
 * Wraps the existing src/lib/transcription/whisper.ts script.
 *
 * M0: Uses existing implementation as-is.
 * M1: Can be replaced with WhisperX for word-level timestamps + diarization.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type { TranscriptionResult, TranscriptSegment } from '@/types/domain';
import type { TranscribeInput, TranscriptionProvider } from './provider';

const execFileAsync = promisify(execFile);

export class LocalWhisperProvider implements TranscriptionProvider {
  getProviderName(): string {
    return 'whisperx';
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const { mediaPath, mimeType } = input;

    if (!mediaPath) {
      throw new Error('LocalWhisperProvider requires a mediaPath');
    }

    if (!existsSync(mediaPath)) {
      throw new Error(`Media file not found: ${mediaPath}`);
    }

    // Delegate to the existing Python whisper script
    // The existing script (scripts/whisper_transcribe.py) handles:
    //   - Audio download (for YouTube)
    //   - Whisper transcription
    //   - Segment output
    try {
      const { stdout } = await execFileAsync('python3', [
        'scripts/whisper_transcribe.py',
        '--file', mediaPath,
        '--format', 'json',
      ], {
        timeout: 30 * 60 * 1000, // 30 minutes for long audio
      });

      const result = JSON.parse(stdout);

      const segments: TranscriptSegment[] = (result.segments || []).map(
        (seg: { start: number; end: number; text: string; speaker?: string; confidence?: number }) => ({
          startMs: Math.round((seg.start || 0) * 1000),
          endMs: Math.round((seg.end || 0) * 1000),
          text: seg.text || '',
          speakerLabel: seg.speaker,
          confidence: seg.confidence ?? 1.0,
        }),
      );

      return {
        segments,
        language: result.language,
        durationMs: result.duration ? Math.round(result.duration * 1000) : undefined,
        provider: this.getProviderName(),
      };
    } catch (error) {
      throw new Error(`Whisper transcription failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
