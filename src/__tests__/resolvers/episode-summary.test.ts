import { describe, it, expect } from 'vitest';
import { isMostlyChinese } from '@/lib/resolvers/episode-summary';

describe('isMostlyChinese (episode summary heuristic)', () => {
  it('returns true for Chinese-dominant text', () => {
    expect(isMostlyChinese('这是一集关于AI的播客')).toBe(true);
    expect(isMostlyChinese('远程工作的未来与挑战')).toBe(true);
  });

  it('returns false for English-dominant text (needs translation)', () => {
    expect(isMostlyChinese('The Future of Remote Work')).toBe(false);
    expect(isMostlyChinese('Why AI alignment matters')).toBe(false);
  });

  it('handles mixed text by CJK ratio (a few Chinese chars among English)', () => {
    // mostly English with one Chinese word → translate
    expect(isMostlyChinese('AI 对 remote work 的影响 x y z')).toBe(false);
  });

  it('handles empty/null/undefined', () => {
    expect(isMostlyChinese('')).toBe(false);
    expect(isMostlyChinese(null)).toBe(false);
    expect(isMostlyChinese(undefined)).toBe(false);
  });
});
