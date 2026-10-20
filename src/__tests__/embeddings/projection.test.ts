import { describe, it, expect } from 'vitest';
import { projectPoints, type EmbeddingPoint } from '@/lib/embeddings/projection';

const mk = (id: string, v: number[], conversationId = 'c1'): EmbeddingPoint => ({
  embeddingId: id,
  vector: v,
  text: id,
  conversationId,
});

describe('projectPoints (V2/T-V2-8)', () => {
  it('returns [] for empty input', async () => {
    expect(await projectPoints([])).toEqual([]);
  });

  it('projects a single point to a 2D coordinate in its own cluster', async () => {
    const out = await projectPoints([mk('a', [1, 0, 0])]);
    expect(out).toHaveLength(1);
    expect(out[0].clusterId).toBeGreaterThanOrEqual(0);
    expect(typeof out[0].x).toBe('number');
    expect(typeof out[0].y).toBe('number');
  });

  it('assigns cluster ids and preserves embeddingId/conversationId', async () => {
    // two well-separated groups of two near-duplicate vectors
    const points = [
      mk('a', [1, 0, 0]),
      mk('b', [0.99, 0.01, 0]),
      mk('c', [0, 1, 0]),
      mk('d', [0, 0.99, 0.01]),
    ];
    const out = await projectPoints(points);
    expect(out.map((p) => p.embeddingId).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(out.every((p) => p.clusterId >= 0)).toBe(true);
    expect(new Set(out.map((p) => p.clusterId)).size).toBeGreaterThanOrEqual(1);
    expect(out.every((p) => p.conversationId === 'c1')).toBe(true);
  });
});
