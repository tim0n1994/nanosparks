import { describe, it, expect } from 'vitest';
import {
  entityResolutionMetrics,
  silhouetteScore,
  cosineDist,
  attributionAccuracy,
  type EntityPair,
  type AttributionSample,
} from '@/lib/eval/extraction-metrics';

describe('entityResolutionMetrics (E5)', () => {
  it('computes perfect precision/recall on all-correct pairs', () => {
    const pairs: EntityPair[] = [
      { same: true, merged: true },
      { same: true, merged: true },
      { same: false, merged: false },
    ];
    const m = entityResolutionMetrics(pairs);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.fp).toBe(0);
  });

  it('counts false-merges (FP) as the dangerous case', () => {
    const pairs: EntityPair[] = [
      { same: true, merged: true },   // TP
      { same: false, merged: true },  // FP (wrongly merged two people)
      { same: true, merged: false },  // FN (missed a merge)
    ];
    const m = entityResolutionMetrics(pairs);
    expect(m.tp).toBe(1);
    expect(m.fp).toBe(1);
    expect(m.fn).toBe(1);
    // precision = 1/2, recall = 1/2, f1 = 0.5
    expect(m.precision).toBeCloseTo(0.5, 6);
    expect(m.recall).toBeCloseTo(0.5, 6);
    expect(m.f1).toBeCloseTo(0.5, 6);
  });

  it('returns zeros on empty input (no divide-by-zero)', () => {
    const m = entityResolutionMetrics([]);
    expect(m).toEqual({ precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0 });
  });
});

describe('silhouetteScore (E5)', () => {
  it('returns 0 for a single cluster (no separation to measure)', () => {
    expect(silhouetteScore([[1, 0], [0.9, 0.1]], [0, 0])).toBe(0);
  });

  it('returns 0 for empty / mismatched input', () => {
    expect(silhouetteScore([], [])).toBe(0);
    expect(silhouetteScore([[1, 0]], [0, 1])).toBe(0);
  });

  it('scores two well-separated clusters above two overlapping ones', () => {
    // two tight, far-apart clusters
    const separated = [[1, 0], [0.99, 0.01], [-1, 0], [-0.99, -0.01]];
    const sepClusters = [0, 0, 1, 1];
    const sepScore = silhouetteScore(separated, sepClusters);

    // two interleaved clusters (low separation)
    const mixed = [[1, 0], [0, 1], [1, 0.01], [0.01, 1]];
    const mixedClusters = [0, 1, 0, 1];
    const mixedScore = silhouetteScore(mixed, mixedClusters);

    expect(sepScore).toBeGreaterThan(mixedScore);
    expect(sepScore).toBeGreaterThan(0);
  });
});

describe('cosineDist (E5)', () => {
  it('is 0 for identical direction, 2 for opposite', () => {
    expect(cosineDist([1, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(cosineDist([1, 0], [-1, 0])).toBeCloseTo(2, 6);
  });
});

describe('attributionAccuracy (E5)', () => {
  it('counts exact matches including both-null as correct', () => {
    const samples: AttributionSample[] = [
      { goldParticipantId: 'p1', predictedParticipantId: 'p1' },
      { goldParticipantId: null, predictedParticipantId: null },
      { goldParticipantId: 'p2', predictedParticipantId: 'p1' }, // wrong
    ];
    const r = attributionAccuracy(samples);
    expect(r.correct).toBe(2);
    expect(r.total).toBe(3);
    expect(r.accuracy).toBeCloseTo(0.667, 2);
  });

  it('returns zeros on empty input', () => {
    expect(attributionAccuracy([])).toEqual({ accuracy: 0, total: 0, correct: 0 });
  });
});
