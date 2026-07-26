import { describe, it, expect } from 'vitest';
import { computeMetrics, admitToDistillation, median, DEFAULT_THRESHOLDS } from '@/lib/transcription/quality-gate';

describe('median', () => {
  it('odd length → middle', () => { expect(median([1, 3, 2])).toBe(2); });
  it('even length → average of two middle', () => { expect(median([1, 2, 3, 4])).toBe(2.5); });
  it('empty → 0', () => { expect(median([])).toBe(0); });
});

describe('computeMetrics', () => {
  it('computes the four §5.6 metrics', () => {
    const m = computeMetrics({
      turnEndMsMax: 9800, durationMs: 10000,
      turnCount: 100, attributedCount: 97,
      attributionConfidences: [0.9, 0.95, 0.85, 0.8, 0.92],
      correctedChars: 40, totalChars: 1000,
    });
    expect(m.coverageRate).toBeCloseTo(0.98, 2);
    expect(m.attributionRate).toBeCloseTo(0.97, 2);
    expect(m.attributionConfidenceMedian).toBe(0.9);
    expect(m.correctionRate).toBeCloseTo(0.04, 2);
  });

  it('unknown duration → coverage null, NEVER fabricated from turnEndMsMax (anti-tautology)', () => {
    const m = computeMetrics({
      turnEndMsMax: 9800, durationMs: 0,
      turnCount: 100, attributedCount: 97,
      attributionConfidences: [0.9], correctedChars: 0, totalChars: 1000,
    });
    expect(m.coverageRate).toBeNull(); // the old fallback made this identically 1.0
  });

  it('no real confidences → median null, not 0 and not a backfilled constant', () => {
    const m = computeMetrics({
      turnEndMsMax: 9800, durationMs: 10000,
      turnCount: 100, attributedCount: 97,
      attributionConfidences: [], correctedChars: 0, totalChars: 1000,
    });
    expect(m.attributionConfidenceMedian).toBeNull();
  });
});

describe('admitToDistillation', () => {
  it('admits when all metrics pass', () => {
    const d = admitToDistillation({
      coverageRate: 0.99, attributionRate: 0.97, attributionConfidenceMedian: 0.9, correctionRate: 0.03, turnCount: 100, durationMs: 10000,
    });
    expect(d.admitted).toBe(true);
    expect(d.fallback).toBe('full');
    expect(d.failures).toHaveLength(0);
  });
  it('rejects and falls back to T0-only when attribution rate is low', () => {
    const d = admitToDistillation({
      coverageRate: 0.99, attributionRate: 0.60, attributionConfidenceMedian: 0.9, correctionRate: 0.03, turnCount: 100, durationMs: 10000,
    });
    expect(d.admitted).toBe(false);
    expect(d.fallback).toBe('t0_only');
    expect(d.failures.some((f) => f.metric === 'attributionRate')).toBe(true);
  });
  it('rejects when correction rate too high (ASR poor or corrector runaway)', () => {
    const d = admitToDistillation({
      coverageRate: 0.99, attributionRate: 0.99, attributionConfidenceMedian: 0.9, correctionRate: 0.20, turnCount: 100, durationMs: 10000,
    });
    expect(d.admitted).toBe(false);
    expect(d.failures.some((f) => f.metric === 'correctionRateMax')).toBe(true);
  });
  it('respects custom thresholds', () => {
    const d = admitToDistillation(
      { coverageRate: 0.90, attributionRate: 0.99, attributionConfidenceMedian: 0.9, correctionRate: 0.03, turnCount: 100, durationMs: 10000 },
      { ...DEFAULT_THRESHOLDS, coverageRate: 0.85 },
    );
    expect(d.admitted).toBe(true);
  });
  it('null metrics are reported as unverified, not silently passed as green', () => {
    const d = admitToDistillation({
      coverageRate: null, attributionRate: 0.99, attributionConfidenceMedian: null, correctionRate: 0.03, turnCount: 100, durationMs: 0,
    });
    expect(d.admitted).toBe(true); // missing metadata is not evidence of bad quality…
    expect(d.unverified).toEqual(['coverageRate', 'attributionConfidenceMedian']); // …but it is not a pass either
  });
});
