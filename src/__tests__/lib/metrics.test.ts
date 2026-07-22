import { describe, it, expect } from 'vitest';
import { activationRate } from '@/lib/metrics';

describe('activationRate', () => {
  it('returns the ratio of first-reads to new users', () => {
    expect(activationRate(40, 100)).toBeCloseTo(0.4, 5);
  });

  it('returns 0 when there are no new users', () => {
    expect(activationRate(10, 0)).toBe(0);
  });

  it('clamps conceptually at 1.0 when every new user finished a read', () => {
    expect(activationRate(100, 100)).toBe(1);
  });
});
