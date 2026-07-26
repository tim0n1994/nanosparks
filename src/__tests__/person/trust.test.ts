import { describe, it, expect } from 'vitest';
import { claimTrust, attributionFactor, traceabilityFactor } from '@/lib/person/trust';

describe('trust algebra (§3)', () => {
  it('real attribution + time-anchored quote → high trust', () => {
    const t = claimTrust(
      { attributionMethod: 'diarization', attributionConfidence: 0.95 },
      { turnId: 't1', startMs: 120_000, endMs: 128_000, quote: '这是一个足够长的真实引文内容' },
    );
    expect(t.score).toBeCloseTo(0.9, 1);
  });

  it('backfilled provenance is scored 0.5, never credited as a real run', () => {
    const f = attributionFactor({ attributionMethod: 'backfill', attributionConfidence: 0.9 });
    expect(f.value).toBe(0.5);
    expect(f.basis).toContain('backfilled');
  });

  it('zero-timestamp span (fabrication signature) tanks traceability', () => {
    const f = traceabilityFactor({ turnId: 't1', startMs: 0, endMs: 0, quote: '看起来像引文但指向 0:00 的东西' });
    expect(f.value).toBe(0.3);
  });

  it('no evidence at all → trust is a product of penalties, not a mystery 0', () => {
    const t = claimTrust(null, null);
    expect(t.score).toBeCloseTo(0.12, 2); // 0.4 × 0.3
    expect(t.factors).toHaveLength(2);
  });

  it('trust is a product — two mediocre stages compound', () => {
    const t = claimTrust(
      { attributionMethod: 'llm', attributionConfidence: null }, // 0.6
      { turnId: 't1', startMs: 5000, endMs: 9000, quote: '短' }, // 0.6
    );
    expect(t.score).toBeCloseTo(0.36, 2);
  });
});
