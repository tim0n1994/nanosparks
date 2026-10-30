import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { WhisperCppProvider } from '@/lib/transcription/whisper-cpp';

describe('WhisperCppProvider', () => {
  beforeEach(() => {
    vi.stubEnv('WHISPER_CPP_PATH', '/nonexistent/whisper-cli');
    vi.stubEnv('WHISPER_CPP_MODEL', '/nonexistent/configured-model.bin');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires explicit private binary and model configuration', () => {
    vi.stubEnv('WHISPER_CPP_PATH', '');
    expect(() => new WhisperCppProvider()).toThrow('set WHISPER_CPP_PATH');
    vi.stubEnv('WHISPER_CPP_PATH', '/nonexistent/whisper-cli');
    vi.stubEnv('WHISPER_CPP_MODEL', '');
    expect(() => new WhisperCppProvider()).toThrow('set WHISPER_CPP_MODEL');
  });

  it('returns whisper-cpp as provider name', () => {
    const p = new WhisperCppProvider();
    expect(p.getProviderName()).toBe('whisper-cpp');
  });

  it('throws on missing media file', async () => {
    const p = new WhisperCppProvider();
    await expect(p.transcribe({ mediaPath: '/nonexistent/audio.wav' })).rejects.toThrow('media file not found');
  });

  it('throws on missing whisper-cli binary', async () => {
    const p = new WhisperCppProvider();
    (p as unknown as { cliPath: string }).cliPath = '/nonexistent/whisper-cli';
    (p as unknown as { modelPath: string }).modelPath = '/nonexistent/model.bin';
    await expect(p.transcribe({ mediaPath: '/etc/hosts' })).rejects.toThrow('whisper-cli binary not found');
  });
});
