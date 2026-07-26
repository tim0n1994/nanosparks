import { describe, it, expect } from 'vitest';
import { buildStanceSpectrum, claimMatchesTopic, type PersonStance } from '@/lib/person/cross-person';

describe('claimMatchesTopic', () => {
  it('matches a phrase substring (case-insensitive)', () => {
    expect(claimMatchesTopic('Open Source is great', 'open source')).toBe(true);
    expect(claimMatchesTopic('OPEN SOURCE is great', 'open source')).toBe(true);
  });
  it('matches when all significant tokens appear (split across the text)', () => {
    expect(claimMatchesTopic('the future of open models in source code', 'open source')).toBe(true);
  });
  it('rejects when tokens are absent', () => {
    expect(claimMatchesTopic('the weather is nice', 'open source')).toBe(false);
    expect(claimMatchesTopic('something', '')).toBe(false);
  });
});

describe('buildStanceSpectrum', () => {
  const mk = (name: string, polarity: number, stance: string): PersonStance => ({
    entityId: name, name, polarity, stance, claimText: `claim ${name}`, claimId: name,
  });
  it('orders assert → neutral → oppose and tallies the distribution', () => {
    const v = buildStanceSpectrum('AGI', [
      mk('a', -1, 'oppose'), mk('b', 1, 'assert'), mk('c', 0, 'neutral'), mk('d', 1, 'assert'),
    ]);
    expect(v.persons.map((p) => p.name)).toEqual(['b', 'd', 'c', 'a']); // assert+ first
    expect(v.distribution).toEqual({ assert: 2, neutral: 1, oppose: 1 });
  });
  it('handles an empty set', () => {
    const v = buildStanceSpectrum('x', []);
    expect(v.persons).toEqual([]);
    expect(v.distribution).toEqual({ assert: 0, neutral: 0, oppose: 0 });
  });
});
