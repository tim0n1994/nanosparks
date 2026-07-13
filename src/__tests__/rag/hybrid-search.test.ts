import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '@/lib/rag/hybrid-search';

describe('reciprocalRankFusion', () => {
  it('fuses two ranked lists by RRF score', () => {
    const listA = ['a', 'b', 'c'];
    const listB = ['b', 'c', 'd'];

    const fused = reciprocalRankFusion([listA, listB], 60);

    // 'b' appears at rank 1 in A and rank 0 in B → highest score
    expect(fused[0].item).toBe('b');
    // 'c' appears at rank 2 in A and rank 1 in B
    expect(fused[1].item).toBe('c');
  });

  it('gives higher score to items in both lists', () => {
    const listA = ['x', 'y', 'z'];
    const listB = ['a', 'x', 'b'];

    const fused = reciprocalRankFusion([listA, listB]);

    // 'x' is in both lists (rank 0 in A, rank 1 in B)
    const xScore = fused.find((f) => f.item === 'x')!.score;
    const yScore = fused.find((f) => f.item === 'y')!.score;
    expect(xScore).toBeGreaterThan(yScore);
  });

  it('handles empty lists', () => {
    const fused = reciprocalRankFusion([[], []]);
    expect(fused).toEqual([]);
  });

  it('handles single list', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c']]);
    expect(fused[0].item).toBe('a');
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it('respects the k parameter', () => {
    const listA = ['a', 'b'];
    const listB = ['a', 'b'];

    const fusedK1 = reciprocalRankFusion([listA, listB], 1);
    const fusedK60 = reciprocalRankFusion([listA, listB], 60);

    // With smaller k, rank differences matter more
    const diffK1 = fusedK1[0].score - fusedK1[1].score;
    const diffK60 = fusedK60[0].score - fusedK60[1].score;
    expect(diffK1).toBeGreaterThan(diffK60);
  });

  it('preserves items only in one list', () => {
    const listA = ['a', 'b'];
    const listB = ['c', 'd'];

    const fused = reciprocalRankFusion([listA, listB]);

    expect(fused).toHaveLength(4);
    // All should have positive scores
    expect(fused.every((f) => f.score > 0)).toBe(true);
  });
});
