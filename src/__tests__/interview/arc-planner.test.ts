import { describe, it, expect } from 'vitest';
import { planArc, seedQuestionFor } from '@/lib/interview/arc-planner';

describe('planArc', () => {
  it('builds an arc from core claims, ranked + time-proportional', () => {
    const fp = { coreClaimsJson: [
      { text: 'Claim A', score: 0.9, recurrence: 3 },
      { text: 'Claim B', score: 0.3, recurrence: 1 },
    ] };
    const arc = planArc({ fingerprint: fp, totalMinutes: 20 });
    expect(arc.topics).toHaveLength(2);
    expect(arc.topics[0].label).toBe('Claim A'); // higher score first
    expect(arc.topics[0].minutes).toBeGreaterThanOrEqual(arc.topics[1].minutes);
    expect(arc.topics.reduce((n, t) => n + t.minutes, 0)).toBeGreaterThanOrEqual(20);
  });

  it('caps topic count', () => {
    const fp = { coreClaimsJson: Array.from({ length: 10 }, (_, i) => ({ text: `c${i}`, score: 1 })) };
    const arc = planArc({ fingerprint: fp, totalMinutes: 20, maxTopics: 3 });
    expect(arc.topics.length).toBeLessThanOrEqual(3);
  });

  it('falls back to a generic arc when no fingerprint/claims', () => {
    const arc = planArc({ fingerprint: null, totalMinutes: 15 });
    expect(arc.topics.length).toBeGreaterThanOrEqual(2);
    expect(arc.topics.every((t) => t.seedQuestion.length > 0)).toBe(true);
  });
});

describe('seedQuestionFor', () => {
  it('wraps a claim into a grounded opening question', () => {
    const q = seedQuestionFor('开源是最好的模式。');
    expect(q).toContain('开源');
    expect(q).toContain('依据');
  });
  it('handles empty input', () => {
    expect(seedQuestionFor('')).toContain('展开');
  });
});
