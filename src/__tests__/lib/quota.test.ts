import { describe, it, expect } from 'vitest';
import { consumesQuota, canTranscribeFromCounts, DEFAULT_QUOTA } from '@/lib/quota';

describe('consumesQuota', () => {
  it('cache hits never consume quota (PRD §7 core rule)', () => {
    expect(consumesQuota(true)).toBe(false);
  });

  it('first-time transcriptions consume quota', () => {
    expect(consumesQuota(false)).toBe(true);
  });
});

describe('canTranscribeFromCounts', () => {
  it('allows when under the limit', () => {
    expect(canTranscribeFromCounts(0, 4)).toBe(true);
    expect(canTranscribeFromCounts(3, 4)).toBe(true);
  });

  it('blocks when the limit is reached', () => {
    expect(canTranscribeFromCounts(4, 4)).toBe(false);
    expect(canTranscribeFromCounts(5, 4)).toBe(false);
  });
});

describe('DEFAULT_QUOTA', () => {
  it('defaults to 4 free first-transcriptions per month (PRD §7 Free)', () => {
    expect(DEFAULT_QUOTA.freeMonthlyFirstTranscriptions).toBe(4);
  });
});
