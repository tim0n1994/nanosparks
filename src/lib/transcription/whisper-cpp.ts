/**
 * WhisperCppProvider — local whisper.cpp ASR (PRD §A2 R3 本地路线).
 *
 * Uses the pre-compiled whisper-cli binary + ggml-large-v3-turbo model already
 * on this machine. No GPU needed (CPU inference), no network, no API key.
 *
 * This is the practical local fallback that makes end-to-end transcription
 * work right now without external services. Output JSON includes word-level
 * timestamps when using --output-json-full.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment, WordTimestamp } from '@/types/domain';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

// Default paths — already on this machine.
const WHISPER_CLI = process.env.WHISPER_CPP_PATH || '/Users/chillbit/Proj/podcast-intel/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_CPP_MODEL || '/Users/chillbit/Proj/podcast-intel/whisper.cpp/models/ggml-large-v3-turbo.bin';

interface WhisperCppWord {
  word: string;
  t0: number; // ms (10ms units in whisper.cpp, but JSON output uses ms)
  t1: number;
  p: number; // probability
}

interface WhisperCppSegment {
  id: number;
  text: string;
  t0: number; // start ms
  t1: number; // end ms
  words?: WhisperCppWord[];
}

interface WhisperCppResult {
  result: { language: string; duration: number };
  transcription: { segments: WhisperCppSegment[] };
}

export class WhisperCppProvider implements TranscriptionProvider {
  private modelPath: string;
  private cliPath: string;

  constructor() {
    this.cliPath = WHISPER_CLI;
    this.modelPath = WHISPER_MODEL;
  }

  getProviderName(): string {
    return 'whisper-cpp';
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const { mediaPath, language } = input;

    if (!mediaPath || !existsSync(mediaPath)) {
      throw new Error(`WhisperCppProvider: media file not found: ${mediaPath}`);
    }
    if (!existsSync(this.cliPath)) {
      throw new Error(`WhisperCppProvider: whisper-cli binary not found: ${this.cliPath}`);
    }
    if (!existsSync(this.modelPath)) {
      throw new Error(`WhisperCppProvider: model not found: ${this.modelPath}`);
    }

    // Create a temp dir for JSON output.
    const tmpDir = mkdtempSync(join(tmpdir(), 'whisper-cpp-'));
 const outputBase = join(tmpDir, 'output');

    const lang = language || 'zh';
    const args = [
      '-m', this.modelPath,
      '-f', mediaPath,
      '-l', lang,
      '-ojf',          // output JSON full (with word timestamps)
      '-of', outputBase,
      '-t', '4',       // 4 threads
      '--no-prints',   // suppress console output
    ];

    logger.info('WhisperCpp transcribing', { mediaPath, model: this.modelPath, lang });

    try {
      await execFileAsync(this.cliPath, args, { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`WhisperCpp transcription failed: ${msg}`);
    }

    // Read the JSON output file.
    const jsonPath = `${outputBase}.json`;
    if (!existsSync(jsonPath)) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw new Error('WhisperCpp: no JSON output produced');
    }

    const raw = readFileSync(jsonPath, 'utf-8');
    rmSync(tmpDir, { recursive: true, force: true });

    const data = JSON.parse(raw) as WhisperCppResult;
    const segments: TranscriptSegment[] = data.transcription.segments.map((seg) => {
      const words: WordTimestamp[] | undefined = seg.words?.length
        ? seg.words.map((w) => ({
            word: w.word,
            startMs: w.t0,
            endMs: w.t1,
            confidence: w.p,
          }))
        : undefined;

      return {
        startMs: seg.t0,
        endMs: seg.t1,
        text: seg.text.trim(),
        speakerLabel: undefined,
        confidence: seg.words?.length ? seg.words.reduce((s, w) => s + w.p, 0) / seg.words.length : 0.9,
        words,
      };
    });

    const detectedLang = data.result.language || lang;
    const durationMs = Math.round(data.result.duration * 1000);

    logger.info('WhisperCpp completed', {
      segments: segments.length,
      language: detectedLang,
      durationMs,
    });

    return {
      segments,
      language: detectedLang,
      durationMs,
      provider: this.getProviderName(),
    };
  }
}
