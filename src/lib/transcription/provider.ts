/**
 * Transcription Provider Interface
 *
 * Abstract interface for transcription services.
 * Supports local (WhisperX), cloud (Deepgram, AssemblyAI), and meeting APIs (Recall.ai).
 *
 * Phase 2: Created as foundation for multi-source ingest.
 * M0: LocalWhisperProvider is the default.
 * M1: Add DeepgramProvider, AssemblyAIProvider, RecallAIProvider.
 */

import type { TranscriptionResult } from '@/types/domain';

export interface TranscribeInput {
  /** Path to media file on local filesystem */
  mediaPath?: string;
  /** Raw media buffer (for uploads not yet saved to disk) */
  mediaBuffer?: Buffer;
  /** MIME type of the media */
  mimeType?: string;
  /** Language hint (ISO 639-1 code) */
  language?: string;
}

export interface TranscriptionProvider {
  /**
   * Transcribe audio/video media to text with timestamps.
   * Must return segments with start/end timestamps and optional speaker labels.
   */
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;

  /** Unique provider identifier (e.g., 'whisperx', 'deepgram', 'assemblyai') */
  getProviderName(): string;
}


