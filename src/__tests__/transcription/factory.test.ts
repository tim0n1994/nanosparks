/**
 * Tests for Transcription Provider Factory & LocalWhisperProvider
 *
 * Tests factory creation, provider interface compliance,
 * and the mock fallback transcription logic.
 *
 * Provider selection is environment-sensitive: the factory's dev-default
 * branch picks Qwen3-ASR when its CLI binary exists on disk. To keep these
 * tests deterministic on any host, QWEN_ASR_CLI is pointed at a path that
 * never exists, so the factory falls through to the LocalWhisperProvider mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTranscriptionProvider } from '@/lib/transcription/factory';
import { LocalWhisperProvider } from '@/lib/transcription/local-whisper';

const KEYS = ['QWEN_ASR_CLI', 'ASR_PROVIDER_OVERRIDE', 'BAILIAN_API_KEY', 'DEEPGRAM_API_KEY', 'WHISPER_CPP_PATH'];
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) { envBackup[k] = process.env[k]; delete process.env[k]; }
  // Force the Qwen CLI probe to a path that never exists, so the factory
  // deterministically falls through to LocalWhisperProvider regardless of host.
  process.env.QWEN_ASR_CLI = '/nonexistent/qwen-asr-test-path';
});
afterEach(() => {
  for (const k of KEYS) {
    if (envBackup[k] !== undefined) process.env[k] = envBackup[k];
    else delete process.env[k];
  }
});

describe('createTranscriptionProvider', () => {
  it('returns a LocalWhisperProvider by default', () => {
    const provider = createTranscriptionProvider();
    expect(provider).toBeInstanceOf(LocalWhisperProvider);
  });

  it('returns an object that conforms to TranscriptionProvider interface', () => {
    const provider = createTranscriptionProvider();

    // Interface compliance: must have transcribe method
    expect(provider).toHaveProperty('transcribe');
    expect(typeof provider.transcribe).toBe('function');

    // Interface compliance: must have getProviderName method
    expect(provider).toHaveProperty('getProviderName');
    expect(typeof provider.getProviderName).toBe('function');
  });

  it('returns whisperx as the provider name', () => {
    const provider = createTranscriptionProvider();
    expect(provider.getProviderName()).toBe('whisperx');
  });
});

describe('LocalWhisperProvider', () => {
  it('throws when no mediaPath is provided', async () => {
    const provider = new LocalWhisperProvider();
    await expect(provider.transcribe({})).rejects.toThrow('requires a mediaPath');
  });

  it('throws when mediaPath does not exist', async () => {
    const provider = new LocalWhisperProvider();
    await expect(
      provider.transcribe({ mediaPath: '/nonexistent/path/file.wav' }),
    ).rejects.toThrow('Media file not found');
  });

  it('returns the correct provider name', () => {
    const provider = new LocalWhisperProvider();
    expect(provider.getProviderName()).toBe('whisperx');
  });

  describe('mockTranscribe (fallback)', () => {
    it('uses mock transcription when whisper script is unavailable', async () => {
      // When the python3 exec fails (no whisper installed in CI/test env),
      // LocalWhisperProvider catches the error and returns a mock result.
      // We test this by providing a real file path so it passes the
      // existence check, but the python exec will fail in test env.

      // Create a temporary file to pass the exists check
      const { mkdir, writeFile, rm } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const testDir = join(process.cwd(), '.test-whisper');
      const testFile = join(testDir, 'test.wav');

      await mkdir(testDir, { recursive: true });
      await writeFile(testFile, Buffer.from('fake audio'));

      try {
        const provider = new LocalWhisperProvider();
        // This will fail at execFileAsync(python3, ...) since there's no
        // whisper script in the test context, and fall back to mockTranscribe
        const result = await provider.transcribe({ mediaPath: testFile });

        // Should return mock result structure
        expect(result).toHaveProperty('segments');
        expect(result).toHaveProperty('provider');
        expect(result.provider).toBe('whisperx');
        expect(Array.isArray(result.segments)).toBe(true);
        expect(result.segments.length).toBeGreaterThan(0);

        // Mock segments have expected structure
        const segment = result.segments[0];
        expect(segment).toHaveProperty('startMs');
        expect(segment).toHaveProperty('endMs');
        expect(segment).toHaveProperty('text');
        expect(segment).toHaveProperty('confidence');
        expect(typeof segment.startMs).toBe('number');
        expect(typeof segment.endMs).toBe('number');
        expect(typeof segment.text).toBe('string');
        expect(segment.endMs).toBeGreaterThanOrEqual(segment.startMs);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});

describe('TranscriptionResult contract', () => {
  it('matches the expected output structure', () => {
    const provider = createTranscriptionProvider();
    // Verify the provider claims compliance
    expect(provider.getProviderName()).toMatch(/^[a-z]+$/);
    expect(provider.transcribe).toBeDefined();
  });
});
