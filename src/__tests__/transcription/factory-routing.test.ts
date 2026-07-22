import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTranscriptionProvider, isChineseSource } from '@/lib/transcription/factory';
import { ParaformerProvider } from '@/lib/transcription/paraformer';
import { DeepgramProvider } from '@/lib/transcription/deepgram';
import { LocalWhisperProvider } from '@/lib/transcription/local-whisper';

describe('isChineseSource', () => {
  it('routes by explicit language code', () => {
    expect(isChineseSource({ language: 'zh' })).toBe(true);
    expect(isChineseSource({ language: 'zh-CN' })).toBe(true);
    expect(isChineseSource({ language: 'en' })).toBe(false);
    expect(isChineseSource({ language: 'EN-US' })).toBe(false);
  });

  it('routes xiaoyuzhou/bilibili platforms to Chinese regardless of title', () => {
    expect(isChineseSource({ platform: 'xiaoyuzhou' })).toBe(true);
    expect(isChineseSource({ platform: 'bilibili' })).toBe(true);
  });

  it('falls back to title hints', () => {
    expect(isChineseSource({ title: '某中文播客标题' })).toBe(true);
    expect(isChineseSource({ title: 'An English Podcast' })).toBe(false);
  });
});

describe('createTranscriptionProvider — language routing (A2)', () => {
  const envBackup: Record<string, string | undefined> = {};
  const KEYS = ['BAILIAN_API_KEY', 'DEEPGRAM_API_KEY', 'ASR_PROVIDER_OVERRIDE'];

  beforeEach(() => {
    for (const k of KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (envBackup[k] !== undefined) process.env[k] = envBackup[k];
      else delete process.env[k];
    }
  });

  it('routes Chinese sources to Paraformer when BAILIAN_API_KEY is set', () => {
    process.env.BAILIAN_API_KEY = 'test-bailian';
    const p = createTranscriptionProvider({ platform: 'xiaoyuzhou' });
    expect(p).toBeInstanceOf(ParaformerProvider);
    expect(p.getProviderName()).toBe('paraformer');
  });

  it('routes English sources to Deepgram when DEEPGRAM_API_KEY is set', () => {
    process.env.DEEPGRAM_API_KEY = 'test-deepgram';
    const p = createTranscriptionProvider({ language: 'en', platform: 'youtube' });
    expect(p).toBeInstanceOf(DeepgramProvider);
  });

  it('honors an explicit provider override', () => {
    process.env.BAILIAN_API_KEY = 'x';
    process.env.DEEPGRAM_API_KEY = 'y';
    expect(createTranscriptionProvider({ override: 'deepgram', platform: 'xiaoyuzhou' })).toBeInstanceOf(
      DeepgramProvider,
    );
    expect(createTranscriptionProvider({ override: 'paraformer', language: 'en' })).toBeInstanceOf(
      ParaformerProvider,
    );
  });

  it('falls back to LocalWhisper when no cloud key is configured', () => {
    const p = createTranscriptionProvider({ platform: 'xiaoyuzhou' });
    expect(p).toBeInstanceOf(LocalWhisperProvider);
  });

  it('falls back to best-effort Paraformer when English-routed but only Bailian is configured', () => {
    process.env.BAILIAN_API_KEY = 'x';
    // English source but no Deepgram key → best-effort Paraformer, not a crash.
    expect(createTranscriptionProvider({ language: 'en' })).toBeInstanceOf(ParaformerProvider);
  });
});
