/**
 * Transcription Provider Factory — language-aware ASR router (A2).
 *
 * Per PRD §A2:
 *   Chinese sources (xiaoyuzhou/bilibili/Chinese title hint) -> Paraformer (R1)
 *   English sources -> Deepgram (R2)
 *   Setting override -> respected
 *   No cloud key -> Local Whisper (R3, privacy/local fallback)
 */

import type { TranscriptionProvider } from './provider';
import { LocalWhisperProvider } from './local-whisper';
import { DeepgramProvider } from './deepgram';
import { ParaformerProvider } from './paraformer';

/** Hints that a source is Chinese (routes to Paraformer when available). */
const CHINESE_HINTS = ['zh', 'xiaoyuzhou', 'bilibili', '小宇宙', 'b站'];

// Detect CJK (Chinese/Japanese/Korean) characters as a Chinese-source signal.
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** True when the source hints indicate Chinese content. */
export function isChineseSource(hints: { language?: string; platform?: string; title?: string }): boolean {
  const lang = (hints.language || '').toLowerCase();
  if (lang.startsWith('zh')) return true;
  if (lang.startsWith('en')) return false;
  const platform = (hints.platform || '').toLowerCase();
  if (platform === 'xiaoyuzhou' || platform === 'bilibili') return true;
  const hay = `${hints.platform ?? ''} ${hints.title ?? ''}`.toLowerCase();
  if (CHINESE_HINTS.some((h) => hay.includes(h))) return true;
  return CJK_REGEX.test(hints.title ?? '');
}

/** Setting override key (PRD: Setting can override the auto route). */
export const ASR_PROVIDER_OVERRIDE_KEY = 'asr.provider';

/**
 * Pick the ASR provider for a source.
 * Resolution order: explicit override -> cloud key for the routed language ->
 * best-effort cloud -> local whisper fallback.
 */
export function createTranscriptionProvider(
  hints: { language?: string; platform?: string; title?: string; override?: string } = {},
): TranscriptionProvider {
  const override = hints.override || process.env.ASR_PROVIDER_OVERRIDE;
  if (override === 'paraformer' && process.env.BAILIAN_API_KEY) {
    return new ParaformerProvider();
  }
  if (override === 'deepgram' && process.env.DEEPGRAM_API_KEY) {
    return new DeepgramProvider();
  }

  // Auto route by language hints.
  if (isChineseSource(hints)) {
    if (process.env.BAILIAN_API_KEY) return new ParaformerProvider();
  } else {
    if (process.env.DEEPGRAM_API_KEY) return new DeepgramProvider();
  }

  // Best-effort cloud, then local whisper.
  if (process.env.BAILIAN_API_KEY) return new ParaformerProvider();
  if (process.env.DEEPGRAM_API_KEY) return new DeepgramProvider();
  return new LocalWhisperProvider();
}
