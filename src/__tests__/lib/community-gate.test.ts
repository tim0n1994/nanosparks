import { describe, it, expect } from 'vitest';
import { gateUnlockedFromCounts, type CommunityGateConfig } from '@/lib/community/gate';

const cfg: CommunityGateConfig = { weeklyUvThreshold: 1000, weeklyHighlightUsersThreshold: 100 };

describe('gateUnlockedFromCounts', () => {
  it('locks when neither threshold is met', () => {
    expect(gateUnlockedFromCounts(500, 50, cfg)).toBe(false);
    expect(gateUnlockedFromCounts(0, 0, cfg)).toBe(false);
  });

  it('unlocks when weekly UV threshold is met (even with few highlighters)', () => {
    expect(gateUnlockedFromCounts(1000, 0, cfg)).toBe(true);
    expect(gateUnlockedFromCounts(1500, 10, cfg)).toBe(true);
  });

  it('unlocks when weekly highlight-user threshold is met (even with low UV)', () => {
    expect(gateUnlockedFromCounts(100, 100, cfg)).toBe(true);
    expect(gateUnlockedFromCounts(0, 150, cfg)).toBe(true);
  });

  it('unlocks at exactly the boundary (inclusive)', () => {
    expect(gateUnlockedFromCounts(999, 99, cfg)).toBe(false);
    expect(gateUnlockedFromCounts(1000, 99, cfg)).toBe(true);
    expect(gateUnlockedFromCounts(999, 100, cfg)).toBe(true);
  });

  it('respects custom thresholds', () => {
    const small = { weeklyUvThreshold: 10, weeklyHighlightUsersThreshold: 5 };
    expect(gateUnlockedFromCounts(10, 0, small)).toBe(true);
    expect(gateUnlockedFromCounts(0, 5, small)).toBe(true);
    expect(gateUnlockedFromCounts(9, 4, small)).toBe(false);
  });
});
