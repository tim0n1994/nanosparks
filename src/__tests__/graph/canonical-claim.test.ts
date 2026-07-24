import { describe, it, expect } from 'vitest';
import { summarizeClusters, pickCentroidRepresentative, cosineDistance } from '@/lib/graph/canonical-claim';

const vec = (...n: number[]) => n;

describe('cosineDistance', () => {
  it('is 0 for identical unit vectors', () => {
    expect(cosineDistance(vec(1, 0), vec(1, 0))).toBeCloseTo(0, 6);
  });
  it('approaches 2 for opposite vectors', () => {
    expect(cosineDistance(vec(1, 0), vec(-1, 0))).toBeCloseTo(2, 6);
  });
});

describe('pickCentroidRepresentative', () => {
  it('returns the only member for a singleton', () => {
    expect(pickCentroidRepresentative([{ vector: vec(1, 0) }])).toBe(0);
  });
  it('picks the member whose direction is nearest the centroid', () => {
    // centroid of these three ≈ (0.63,0.37); the (0.9,0.1) member shares that direction.
    const members = [{ vector: vec(1, 0) }, { vector: vec(0.9, 0.1) }, { vector: vec(0, 1) }];
    expect(pickCentroidRepresentative(members)).toBe(1);
  });
});

describe('summarizeClusters', () => {
  const t0 = new Date('2026-01-01');
  const t1 = new Date('2026-03-01');
  const members = [
    { id: 'a', text: 'AI is useful', vector: vec(1, 0), assertedAt: t0 },
    { id: 'b', text: 'AI helps people', vector: vec(0.99, 0.01), assertedAt: t1 },
    { id: 'c', text: 'Cooking pasta', vector: vec(0, 1), assertedAt: t1 },
  ];

  it('builds a draft per cluster with centroid representative + time range', () => {
    const drafts = summarizeClusters(members, [[0, 1], [2]], 1);
    expect(drafts).toHaveLength(2);
    const aiClaim = drafts.find((d) => d.memberTuIds.includes('a'));
    expect(aiClaim).toBeTruthy();
    expect(aiClaim!.firstAssertedAt).toEqual(t0);
    expect(aiClaim!.lastAssertedAt).toEqual(t1);
    expect(aiClaim!.memberTuIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('promotes noise/singletons to their own claim so nothing is lost', () => {
    // clusterGroups empty (all noise) → every member becomes a singleton claim
    const drafts = summarizeClusters(members, [], 1);
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.memberTuIds.length === 1)).toBe(true);
  });

  it('respects minClusterSize (drops sub-threshold groups → still surfaced as singletons)', () => {
    const drafts = summarizeClusters(members, [[0, 1]], 3); // group of 2 < min 3
    // the [0,1] group is dropped, so a,b,c each become singletons
    expect(drafts).toHaveLength(3);
  });
});
