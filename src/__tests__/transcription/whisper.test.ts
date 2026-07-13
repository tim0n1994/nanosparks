import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the provider module — whisper.ts imports from whisper-providers.ts,
// so cross-module vi.mock works correctly.
vi.mock('@/lib/transcription/whisper-providers', () => ({
  transcribeWithDeepgram: vi.fn(),
  transcribeWithLocalWhisper: vi.fn(),
  WhisperExecutionError: class WhisperExecutionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WhisperExecutionError';
    }
  },
}));

import { transcribeAudio } from '@/lib/transcription/whisper';
import {
  transcribeWithDeepgram,
  transcribeWithLocalWhisper,
  WhisperExecutionError,
} from '@/lib/transcription/whisper-providers';

const mockDeepgram = vi.mocked(transcribeWithDeepgram);
const mockLocalWhisper = vi.mocked(transcribeWithLocalWhisper);

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockDeepgram.mockReset();
    mockLocalWhisper.mockReset();
  });

  it('returns segments on successful deepgram execution', async () => {
    mockDeepgram.mockResolvedValue([
      { start: 0, end: 2, text: 'Hello' },
      { start: 2, end: 4, text: 'world' },
    ]);

    const result = await transcribeAudio('/tmp/test.mp3');

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello');
    expect(result[0].start).toBe(0);
    expect(result[1].end).toBe(4);
    expect(mockLocalWhisper).not.toHaveBeenCalled();
  });

  it('falls back to local whisper when deepgram fails', async () => {
    mockDeepgram.mockRejectedValue(new Error('DEEPGRAM_API_KEY not configured'));
    mockLocalWhisper.mockResolvedValue([
      { start: 0, end: 5, text: 'Hello from whisper' },
    ]);

    const result = await transcribeAudio('/tmp/test.mp3');

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello from whisper');
    expect(mockLocalWhisper).toHaveBeenCalled();
  });

  it('falls back to mock transcript on execution failure in non-production', async () => {
    mockDeepgram.mockRejectedValue(new Error('DEEPGRAM_API_KEY not configured'));
    mockLocalWhisper.mockRejectedValue(
      new WhisperExecutionError('Command failed: python3 not installed'),
    );

    const result = await transcribeAudio('/tmp/test.mp3');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toBe('Welcome to the podcast.');
  });

  it('throws when all providers fail with non-execution errors', async () => {
    mockDeepgram.mockRejectedValue(new Error('DEEPGRAM_API_KEY not configured'));
    mockLocalWhisper.mockRejectedValue(new Error('Unexpected token in JSON'));

    await expect(transcribeAudio('/tmp/test.mp3')).rejects.toThrow();
  });

  it('throws when all providers fail in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    vi.stubEnv('NODE_ENV', 'production');

    mockDeepgram.mockRejectedValue(new Error('DEEPGRAM_API_KEY not configured'));
    mockLocalWhisper.mockRejectedValue(
      new WhisperExecutionError('Command failed: python3 not installed'),
    );

    await expect(transcribeAudio('/tmp/test.mp3')).rejects.toThrow();

    vi.stubEnv('NODE_ENV', originalEnv || '');
  });
});
