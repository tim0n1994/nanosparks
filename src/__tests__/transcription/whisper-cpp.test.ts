import { describe, it, expect } from 'vitest';
import { WhisperCppProvider } from '@/lib/transcription/whisper-cpp';

describe('WhisperCppProvider', () => {
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
