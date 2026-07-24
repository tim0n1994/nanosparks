import { describe, it, expect } from 'vitest';
import { clusterSamples, fallbackLabel, type ProjectedPoint } from '@/lib/embeddings/projection';

const pt = (clusterId: number, text: string, embeddingId = text): ProjectedPoint => ({
  embeddingId, x: 0, y: 0, clusterId, text, conversationId: 'c1',
});

describe('projection cluster helpers (V2/T-V2-8)', () => {
  it('groups member texts by cluster, capped at sampleSize', () => {
    const points = [pt(0, 'a'), pt(0, 'b'), pt(0, 'c'), pt(1, 'x'), pt(1, 'y')];
    const samples = clusterSamples(points, 2);
    expect(samples.get(0)).toEqual(['a', 'b']);
    expect(samples.get(1)).toEqual(['x', 'y']);
  });

  it('fallback label is 1-indexed human label', () => {
    expect(fallbackLabel(0)).toBe('主题 1');
    expect(fallbackLabel(3)).toBe('主题 4');
  });

  it('empty points → empty map', () => {
    expect(clusterSamples([]).size).toBe(0);
  });
});
