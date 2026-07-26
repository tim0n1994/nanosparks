import { describe, it, expect } from 'vitest';
import { cleanCjkSpaces, isCJK } from '@/lib/transcription/cjk-space-cleanup';

describe('isCJK', () => {
  it('detects CJK ideographs', () => {
    expect(isCJK('中')).toBe(true);
    expect(isCJK('文')).toBe(true);
    expect(isCJK('哈')).toBe(true);
    expect(isCJK('A')).toBe(false);
    expect(isCJK(' ')).toBe(false);
    expect(isCJK('1')).toBe(false);
  });
});

describe('cleanCjkSpaces', () => {
  it('removes spaces between CJK characters', () => {
    expect(cleanCjkSpaces('哈 喽 大家好')).toBe('哈喽大家好');
    expect(cleanCjkSpaces('我是 小 俊')).toBe('我是小俊');
  });

  it('preserves spaces at CJK-ASCII boundaries (中英混排)', () => {
    // CJK-space-CJK is removed; CJK-space-ASCII and ASCII-space-CJK are preserved.
    expect(cleanCjkSpaces('用 AI 做 产品')).toBe('用 AI 做产品');
    expect(cleanCjkSpaces('ChatGPT 那些 东西')).toBe('ChatGPT 那些东西');
  });

  it('preserves normal English spacing', () => {
    expect(cleanCjkSpaces('hello world foo bar')).toBe('hello world foo bar');
  });

  it('collapses multiple spaces', () => {
    expect(cleanCjkSpaces('hello   world')).toBe('hello world');
    expect(cleanCjkSpaces('中文   测试')).toBe('中文测试'); // collapse then CJK-space-CJK remove
  });

  it('handles the actual Tristan ASR sample', () => {
    const sample = '哈 喽 大家好我是 小 俊 春节 前后 一款 ai n at ive 的产品';
    const cleaned = cleanCjkSpaces(sample);
    expect(cleaned).toContain('哈喽大家好我是小俊春节前后');
    expect(cleaned).toContain('ai n at ive');
    expect(cleaned).toContain('的产品');
  });

  it('handles empty / null', () => {
    expect(cleanCjkSpaces('')).toBe('');
  });
});
