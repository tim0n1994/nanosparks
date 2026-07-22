import { describe, it, expect } from 'vitest';
import { QwenAsrProvider } from '@/lib/transcription/qwen-asr';

describe('QwenAsrProvider', () => {
  it('returns qwen-asr as provider name', () => {
    const p = new QwenAsrProvider();
    expect(p.getProviderName()).toBe('qwen-asr');
  });

  it('throws on missing media file', async () => {
    const p = new QwenAsrProvider();
    await expect(p.transcribe({ mediaPath: '/nonexistent/audio.wav' })).rejects.toThrow('media file not found');
  });
});
