/**
 * Transcription Provider Factory
 *
 * Picks the best available provider:
 * 1. Deepgram (cloud) — when DEEPGRAM_API_KEY is set
 * 2. Local Whisper — fallback
 */

import type { TranscriptionProvider } from './provider';
import { LocalWhisperProvider } from './local-whisper';
import { DeepgramProvider } from './deepgram';

export function createTranscriptionProvider(): TranscriptionProvider {
  if (process.env.DEEPGRAM_API_KEY) {
    return new DeepgramProvider(process.env.DEEPGRAM_API_KEY);
  }
  return new LocalWhisperProvider();
}
