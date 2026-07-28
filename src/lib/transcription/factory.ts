/**
 * Transcription Provider Factory.
 *
 * Priority: Qwen3-ASR (local/dev only) -> Paraformer (cloud CN) ->
 * Deepgram (cloud EN) -> whisper.cpp (CPU) -> local-whisper (mock).
 *
 * Qwen3-ASR (mlx) requires Apple Silicon and runs as a single local server,
 * so it is dev-only by default. In production (Linux VPS) it is skipped
 * unless explicitly forced via ASR_PROVIDER_OVERRIDE=qwen.
 */

import type { TranscriptionProvider } from './provider';
import { LocalWhisperProvider } from './local-whisper';
import { DeepgramProvider } from './deepgram';
import { ParaformerProvider } from './paraformer';
import { existsSync } from 'node:fs';
import { WhisperCppProvider } from './whisper-cpp';
import { QwenAsrProvider } from './qwen-asr';

/** Check if the mlx-qwen3-asr CLI binary is installed (venv path or QWEN_ASR_CLI env). */
function qwenCliAvailable(): boolean {
  const cliPath = process.env.QWEN_ASR_CLI || `${process.env.HOME}/qwen-asr-env/bin/mlx-qwen3-asr`;
  return existsSync(cliPath);
}

export function createTranscriptionProvider(
  _hints: { language?: string; platform?: string; title?: string; override?: string } = {},
): TranscriptionProvider {
  // 0. Explicit override.
  const override = _hints.override || process.env.ASR_PROVIDER_OVERRIDE;
  if (override === 'paraformer' && process.env.BAILIAN_API_KEY) return new ParaformerProvider();
  if (override === 'deepgram' && process.env.DEEPGRAM_API_KEY) return new DeepgramProvider();
  if (override === 'qwen' && qwenCliAvailable()) return new QwenAsrProvider();
  if (override === 'whisper-cpp' && process.env.WHISPER_CPP_PATH) return new WhisperCppProvider();

  // 1. Qwen3-ASR CLI — dev-only default (Apple Silicon mlx; not deployable to
  //    a Linux VPS). Checks for the CLI binary presence rather than an HTTP URL.
  if (process.env.NODE_ENV !== 'production' && qwenCliAvailable()) {
    return new QwenAsrProvider();
  }
  // 2. Paraformer (cloud Chinese).
  if (process.env.BAILIAN_API_KEY) return new ParaformerProvider();
  // 3. Deepgram (cloud English).
  if (process.env.DEEPGRAM_API_KEY) return new DeepgramProvider();
  // 4. whisper.cpp local (CPU, ggml-large-v3-turbo).
  if (process.env.WHISPER_CPP_PATH) return new WhisperCppProvider();
  // 5. Mock fallback.
  return new LocalWhisperProvider();
}

// Kept for backward compat with existing tests.
export function isChineseSource(hints: { language?: string; platform?: string; title?: string }): boolean {
  const lang = (hints.language || '').toLowerCase();
  if (lang.startsWith('zh')) return true;
  const platform = (hints.platform || '').toLowerCase();
  if (platform === 'xiaoyuzhou' || platform === 'bilibili') return true;
  return /[\u4e00-\u9fff]/.test(hints.title ?? '');
}

export const ASR_PROVIDER_OVERRIDE_KEY = 'asr.provider';
