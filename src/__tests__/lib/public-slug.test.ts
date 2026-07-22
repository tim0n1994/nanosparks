import { describe, it, expect } from 'vitest';
import { slugBase, slugSuffix } from '@/lib/public-slug';

describe('slugBase', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugBase('Hello World Foo')).toBe('hello-world-foo');
  });

  it('strips punctuation but keeps CJK', () => {
    expect(slugBase('好奇心，与创造力！')).toBe('好奇心与创造力');
  });

  it('collapses repeated hyphens and trims edges', () => {
    expect(slugBase('  a -- b  ')).toBe('a-b');
  });

  it('caps length to 40 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugBase(long).length).toBeLessThanOrEqual(40);
  });

  it('returns empty for punctuation-only titles', () => {
    expect(slugBase('!!!???')).toBe('');
  });
});

describe('slugSuffix', () => {
  it('produces a stable 5-char suffix for the same seed', () => {
    expect(slugSuffix('conv_abc')).toBe(slugSuffix('conv_abc'));
  });

  it('produces different suffixes for different seeds', () => {
    expect(slugSuffix('a')).not.toBe(slugSuffix('b'));
  });

  it('always returns exactly 5 chars', () => {
    expect(slugSuffix('x').length).toBe(5);
    expect(slugSuffix('very-long-seed-12345').length).toBe(5);
  });
});
