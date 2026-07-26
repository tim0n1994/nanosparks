import { describe, it, expect } from 'vitest';
import {
  stancePolarity, clusterByTopic, detectStanceChanges, falsePositiveRate,
  type DriftClaim,
} from '@/lib/person/stance-drift';

describe('stancePolarity', () => {
  it('maps stance vocab to {-1,0,+1}', () => {
    expect(stancePolarity('assert')).toBe(1);
    expect(stancePolarity('support')).toBe(1);
    expect(stancePolarity('oppose')).toBe(-1);
    expect(stancePolarity('disagree')).toBe(-1);
    expect(stancePolarity('question')).toBe(0);
    expect(stancePolarity('neutral')).toBe(0);
    expect(stancePolarity('')).toBe(0);
  });
});

describe('clusterByTopic', () => {
  it('groups claims sharing significant tokens', () => {
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source is the best model for infrastructure', stance: 'assert', assertedAt: 1 },
      { id: 'b', text: 'open source infrastructure scales well', stance: 'assert', assertedAt: 2 },
      { id: 'c', text: 'the weather today is sunny and warm', stance: 'assert', assertedAt: 3 },
    ];
    const clusters = clusterByTopic(claims);
    expect(clusters.size).toBe(2); // {a,b} share open/source/infrastructure; {c} alone
  });
});

describe('detectStanceChanges', () => {
  it('detects a stance flip across time within a topic cluster', () => {
    const t0 = new Date('2023-01-01').getTime();
    const t1 = new Date('2025-01-01').getTime();
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source is the best model for infrastructure', stance: 'assert', assertedAt: t0 },
      { id: 'b', text: 'open source infrastructure no longer works for this', stance: 'oppose', assertedAt: t1 },
    ];
    const changes = detectStanceChanges(claims);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('flip');
    expect(changes[0].before.assertedAt).toBe(t0);
    expect(changes[0].after.assertedAt).toBe(t1);
  });

  it('produces NO change when all claims share one timestamp (single episode)', () => {
    const t = new Date('2024-06-01').getTime();
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source is the best model for infrastructure', stance: 'assert', assertedAt: t },
      { id: 'b', text: 'open source infrastructure no longer works', stance: 'oppose', assertedAt: t },
    ];
    expect(detectStanceChanges(claims)).toHaveLength(0);
  });

  it('does not flag a change when polarity is unchanged across time', () => {
    const t0 = new Date('2023-01-01').getTime();
    const t1 = new Date('2025-01-01').getTime();
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source infrastructure is good', stance: 'assert', assertedAt: t0 },
      { id: 'b', text: 'open source infrastructure still good', stance: 'assert', assertedAt: t1 },
    ];
    expect(detectStanceChanges(claims)).toHaveLength(0);
  });

  it('ignores neutral/question stances (no real position to flip)', () => {
    const t0 = new Date('2023-01-01').getTime();
    const t1 = new Date('2025-01-01').getTime();
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source infrastructure maybe', stance: 'question', assertedAt: t0 },
      { id: 'b', text: 'open source infrastructure works', stance: 'assert', assertedAt: t1 },
    ];
    expect(detectStanceChanges(claims)).toHaveLength(0);
  });

  it('§7.3: a quoted (host-echoing) claim is excluded from drift', () => {
    const t0 = new Date('2023-01-01').getTime();
    const t1 = new Date('2025-01-01').getTime();
    const claims: DriftClaim[] = [
      { id: 'a', text: 'open source infrastructure is the best', stance: 'assert', assertedAt: t0, modality: 'asserted' },
      { id: 'b', text: 'open source infrastructure no longer works', stance: 'oppose', assertedAt: t1, modality: 'quoted' },
    ];
    // b is quoted (host echoing) → not the person's stance → no false "flip"
    expect(detectStanceChanges(claims)).toHaveLength(0);
  });
});

describe('falsePositiveRate', () => {
  it('computes the FP rate against a gold set', () => {
    const detected = [
      { topicKey: 'a', before: {} as never, after: {} as never, kind: 'flip' as const },
      { topicKey: 'b', before: {} as never, after: {} as never, kind: 'flip' as const },
    ];
    expect(falsePositiveRate(detected, new Set(['a']))).toBe(50);
    expect(falsePositiveRate(detected, new Set(['a', 'b']))).toBe(0);
  });
  it('returns 0 for empty detection', () => {
    expect(falsePositiveRate([], new Set())).toBe(0);
  });
});
