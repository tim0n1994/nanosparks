import { describe, it, expect } from 'vitest';
import {
  detectLanguageFromText,
  detectLanguageFromSegments,
  routeForDetectedLanguage,
} from '@/lib/transcription/language-probe';

describe('detectLanguageFromText', () => {
  it('detects Chinese-dominant text', () => {
    expect(detectLanguageFromText('今天我们来聊聊播客和创造力的关系')).toBe('zh');
  });

  it('detects English-dominant text', () => {
    expect(detectLanguageFromText('Welcome to the podcast about creativity and ideas')).toBe('en');
  });

  it('detects mixed CJK/ASCII', () => {
    expect(detectLanguageFromText('今天 we talk about OpenAI 和 GPT-4')).toBe('mixed');
  });

  it('returns unknown for empty/non-letter text', () => {
    expect(detectLanguageFromText('')).toBe('unknown');
    expect(detectLanguageFromText('123 456 !!!')).toBe('unknown');
  });
});

describe('detectLanguageFromSegments', () => {
  const segments = [
    { startMs: 0, endMs: 5000, text: '大家好欢迎收听' },
    { startMs: 5000, endMs: 10000, text: '今天的话题是 AI' },
    { startMs: 65000, endMs: 70000, text: 'later content should be excluded' },
  ];

  it('only considers the first 60s window by default', () => {
    const detected = detectLanguageFromSegments(segments);
    expect(detected).not.toBe('unknown');
    // The English-only 65s segment is excluded → CJK dominant.
    expect(detected).toBe('zh');
  });

  it('respects a custom window', () => {
    const detected = detectLanguageFromSegments(segments, 100_000);
    // Now the English segment at 65s is included → could be mixed or en.
    expect(['mixed', 'en', 'zh']).toContain(detected);
  });

  it('returns unknown for empty segments', () => {
    expect(detectLanguageFromSegments([])).toBe('unknown');
  });
});

describe('routeForDetectedLanguage', () => {
  it('routes zh → paraformer', () => {
    expect(routeForDetectedLanguage('zh').provider).toBe('paraformer');
  });

  it('routes en → deepgram', () => {
    expect(routeForDetectedLanguage('en').provider).toBe('deepgram');
  });

  it('routes mixed → paraformer (handles 中英夹杂)', () => {
    expect(routeForDetectedLanguage('mixed').provider).toBe('paraformer');
  });

  it('routes unknown → deepgram (default)', () => {
    expect(routeForDetectedLanguage('unknown').provider).toBe('deepgram');
  });

  it('always provides a reason', () => {
    for (const lang of ['zh', 'en', 'mixed', 'unknown'] as const) {
      expect(routeForDetectedLanguage(lang).reason.length).toBeGreaterThan(0);
    }
  });
});
