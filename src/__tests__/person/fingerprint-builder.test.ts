import { describe, it, expect } from 'vitest';
import { rankCoreClaims, normalizeClaimText, evidenceTypeDistribution, hedgeRate } from '@/lib/person/fingerprint-builder';

describe('normalizeClaimText', () => {
  it('lowercases, collapses whitespace, strips trailing punctuation', () => {
    expect(normalizeClaimText('AI will change everything.')).toBe('ai will change everything');
    expect(normalizeClaimText('  AI  will  Change!! ')).toBe('ai will change');
    expect(normalizeClaimText('机器会取代人类。')).toBe('机器会取代人类');
  });

  it('makes near-duplicates collapse to the same key', () => {
    expect(normalizeClaimText('AI is great.')).toBe(normalizeClaimText('ai is great'));
  });
});

describe('rankCoreClaims', () => {
  const claims = [
    { id: 'c1', text: 'AI is great', evidenceType: 'experiential', polarity: 0.9 },
    { id: 'c2', text: 'AI is great', evidenceType: 'experiential', polarity: 0.8 }, // dup → recurrence 2
    { id: 'c3', text: 'Moore is dead', evidenceType: 'data', polarity: 0.7 },
    { id: 'c4', text: 'vibes matter', evidenceType: null, polarity: null },
  ];

  it('ranks recurring claims higher (recurrence × evidence weight)', () => {
    const ranked = rankCoreClaims(claims);
    // 'AI is great' appears twice with experiential (weight 1.0) → top.
    expect(ranked[0].text).toBe('AI is great');
    expect(ranked[0].recurrence).toBe(2);
    expect(ranked[0].evidenceType).toBe('experiential');
  });

  it('respects the limit option', () => {
    expect(rankCoreClaims(claims, { limit: 1 })).toHaveLength(1);
  });

  it('dedupes near-duplicate text into one bucket', () => {
    expect(rankCoreClaims(claims)).toHaveLength(3); // AI×2 collapses, Moore, vibes
  });

  it('returns empty for no claims', () => {
    expect(rankCoreClaims([])).toEqual([]);
  });
});

describe('evidenceTypeDistribution', () => {
  it('returns percentages summing ~100 across known types', () => {
    const d = evidenceTypeDistribution(['experiential', 'experiential', 'data', null]);
    expect(d.experiential).toBe(50);
    expect(d.data).toBe(25);
    expect(d.none).toBe(25);
  });

  it('handles empty input', () => {
    expect(evidenceTypeDistribution([])).toEqual({ none: 0 });
  });
});

describe('hedgeRate', () => {
  it('counts turns opening with a hedge qualifier (en + zh)', () => {
    expect(hedgeRate(['I think this works', 'Definitely yes', 'maybe later'])).toBeCloseTo(66.7, 1);
    expect(hedgeRate(['我觉得可能', '一定是'])).toBe(50);
  });

  it('returns 0 for empty input', () => {
    expect(hedgeRate([])).toBe(0);
  });

  it('does not count hedge words mid-sentence', () => {
    expect(hedgeRate(['this is maybe the issue'])).toBe(0);
  });
});
