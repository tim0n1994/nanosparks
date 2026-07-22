import { describe, it, expect } from 'vitest';
import {
  scanSensitiveWords,
  applySensitiveRewrites,
  summarizeCategories,
  isClean,
} from '@/lib/publish/sensitive-words';

describe('scanSensitiveWords', () => {
  it('detects absolute-superlative terms', () => {
    const hits = scanSensitiveWords('这是市面上最好的产品');
    expect(hits).toHaveLength(1);
    expect(hits[0].category).toBe('absolute');
    expect(hits[0].term).toBe('最好');
    expect(hits[0].suggestion).toBe('很好');
  });

  it('detects medical claims', () => {
    const hits = scanSensitiveWords('能根治你的失眠');
    expect(hits[0].category).toBe('medical');
    expect(hits[0].suggestion).toBe('改善');
  });

  it('detects lead-generation words', () => {
    const hits = scanSensitiveWords('感兴趣加微信详聊');
    expect(hits.some((h) => h.category === 'lead_generation' && h.term === '加微信')).toBe(true);
  });

  it('returns hits sorted by position', () => {
    const hits = scanSensitiveWords('最好，而且私聊我');
    expect(hits[0].startIndex).toBeLessThan(hits[1].startIndex);
  });

  it('finds multiple occurrences of the same term', () => {
    const hits = scanSensitiveWords('最好 最好 最好');
    expect(hits).toHaveLength(3);
  });

  it('returns empty for clean text', () => {
    expect(scanSensitiveWords('这是一段普通的播客解读')).toEqual([]);
  });

  it('is case-insensitive', () => {
    const hits = scanSensitiveWords('100% Guaranteed');
    expect(hits.some((h) => h.term === '100%')).toBe(true);
  });

  it('reports correct start/end indices', () => {
    const text = 'xx最好yy';
    const hits = scanSensitiveWords(text);
    expect(text.slice(hits[0].startIndex, hits[0].endIndex)).toBe('最好');
  });
});

describe('applySensitiveRewrites', () => {
  it('replaces terms with suggestions', () => {
    const { rewritten, applied } = applySensitiveRewrites('这是最好的');
    expect(rewritten).toBe('这是很好的');
    expect(applied).toBe(1);
  });

  it('deletes terms with empty suggestion', () => {
    const { rewritten, applied } = applySensitiveRewrites('感兴趣加微信详聊');
    expect(rewritten).toBe('感兴趣详聊');
    expect(applied).toBe(1);
  });

  it('handles multiple distinct terms in one pass', () => {
    const { rewritten, applied } = applySensitiveRewrites('最好根治');
    expect(rewritten).toBe('很好改善');
    expect(applied).toBe(2);
  });

  it('leaves clean text unchanged', () => {
    const { rewritten, applied } = applySensitiveRewrites('普通文本');
    expect(rewritten).toBe('普通文本');
    expect(applied).toBe(0);
  });
});

describe('summarizeCategories + isClean', () => {
  it('lists unique categories', () => {
    const hits = scanSensitiveWords('最好加微信');
    expect(summarizeCategories(hits).sort()).toEqual(['absolute', 'lead_generation']);
  });

  it('isClean returns true only when no hits', () => {
    expect(isClean('普通文本')).toBe(true);
    expect(isClean('最好')).toBe(false);
  });
});
