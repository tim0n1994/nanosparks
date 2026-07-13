import { TranscriptSegment } from '@/types/analysis';
import { logger } from '@/lib/logger';
import {
  transcribeWithDeepgram,
  transcribeWithLocalWhisper,
  WhisperExecutionError,
} from './whisper-providers';

// Re-export for backwards compatibility (other modules import these from whisper.ts)
export { transcribeWithDeepgram, transcribeWithLocalWhisper, WhisperExecutionError };

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const errors: Error[] = [];

  // Try Deepgram first
  try {
    return await transcribeWithDeepgram(audioPath);
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  // Fallback to local Whisper
  try {
    return await transcribeWithLocalWhisper(audioPath);
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  // Last resort: if the failure was an execution error (no binary / not
  // installed), fall back to a mock transcript so the pipeline can be
  // exercised in dev/CI without a working ASR backend.
  const hasExecError = errors.some(
    (e) =>
      e instanceof WhisperExecutionError ||
      e.message.includes('not installed') ||
      e.message.includes('ENOENT') ||
      e.message.includes('Command failed'),
  );

  if (hasExecError && process.env.NODE_ENV !== 'production') {
    logger.warn('All transcription providers failed, using mock transcript', {
      errors: errors.map((e) => e.message),
    });
    return [
      { start: 0, end: 5, text: 'Welcome to the podcast.', speakerId: undefined },
    ];
  }

  throw new Error(
    `All transcription methods failed: ${errors.map((e) => e.message).join('; ')}`,
  );
}

// TODO: Implement speaker diarization using pyannote.audio or whisperx
// export async function diarize(audioPath: string): Promise<SpeakerSegment[]> { ... }
