/**
 * Transcription Provider Factory.
 *
 * Priority: Qwen3-ASR (local, multilingual) -> Paraformer (cloud CN) ->
 * Deepgram (cloud EN) -> whisper.cpp (CPU) -> local-whisper (mock).
 *
 * Qwen3-ASR handles both Chinese AND English natively, so when its server is
 * running it's the single default — no language routing needed.
 */

import type { TranscriptionProvider } from './provider';
import { LocalWhisperProvider } from './local-whisper';
import { DeepgramProvider } from './deepgram';
import { ParaformerProvider } from './paraformer';
import { WhisperCppProvider } from './whisper-cpp';
import { QwenAsrProvider } from './qwen-asr';

export function createTranscriptionProvider(
  _hints: { language?: string; platform?: string; title?: string; override?: string } = {},
): TranscriptionProvider {
  // 0. Explicit override.
  const override = _hints.override || process.env.ASR_PROVIDER_OVERRIDE;
  if (override === 'paraformer' && process.env.BAILIAN_API_KEY) return new ParaformerProvider();
  if (override === 'deepgram' && process.env.DEEPGRAM_API_KEY) return new DeepgramProvider();
  if (override === 'qwen' && process.env.QWEN_ASR_URL) return new QwenAsrProvider();
  if (override === 'whisper-cpp' && process.env.WHISPER_CPP_PATH) return new WhisperCppProvider();

  // 1. Qwen3-ASR local server — multilingual, best quality, no API key.
  if (process.env.QWEN_ASR_URL) return new QwenAsrProvider();
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
