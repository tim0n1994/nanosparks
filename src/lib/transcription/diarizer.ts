/**
 * Diarization Provider
 *
 * Wraps the pyannote.audio 4.0 community-1 Python pipeline.
 * Runs as a separate job from transcription — both consume the same audio asset.
 *
 * The pyannote community-1 pipeline supports "exclusive mode" which keeps only
 * the most likely speaker at each time step, designed to align with Whisper
 * word-level timestamps without complex alignment glue.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'path';
import type { DiarizationResult, SpeakerSegment } from '@/types/domain';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

interface PyannoteResult {
  segments: Array<{ label: string; start: number; end: number; confidence?: number }>;
  speakerCount: number;
  error?: string;
}

export class PyannoteDiarizer {
  getProviderName(): string {
    return 'pyannote-community-1';
  }

  async diarize(audioPath: string, opts?: { exclusiveMode?: boolean }): Promise<DiarizationResult> {
    if (!existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'pyannote_diarize.py');
    const args = ['--audio', audioPath, '--format', 'json'];
    if (opts?.exclusiveMode === false) {
      args.push('--no-exclusive');
    }

    logger.info('Starting pyannote diarization', { audioPath, exclusiveMode: opts?.exclusiveMode !== false });

    let stdout: string;
    try {
      const result = await execFileAsync('python3', [scriptPath, ...args], {
        timeout: 30 * 60 * 1000, // 30 min
        maxBuffer: 50 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      // Check if the error output contains structured error JSON
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Pyannote diarization failed', { error: errMsg });

      // If pyannote is not installed, return empty diarization (not a hard failure)
      if (errMsg.includes('not installed') || errMsg.includes('No module named')) {
        logger.warn('pyannote.audio not available, skipping diarization');
        return {
          segments: [],
          speakerCount: 0,
          provider: this.getProviderName(),
        };
      }
      throw new Error(`Diarization failed: ${errMsg}`);
    }

    const parsed = JSON.parse(stdout) as PyannoteResult;

    if (parsed.error) {
      logger.warn('Pyannote returned error, skipping diarization', { error: parsed.error });
      return {
        segments: [],
        speakerCount: 0,
        provider: this.getProviderName(),
      };
    }

    const segments: SpeakerSegment[] = parsed.segments.map((seg) => ({
      label: seg.label,
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      confidence: seg.confidence,
    }));

    logger.info('Diarization completed', {
      segments: segments.length,
      speakerCount: parsed.speakerCount,
    });

    return {
      segments,
      speakerCount: parsed.speakerCount,
      provider: this.getProviderName(),
    };
  }
}
