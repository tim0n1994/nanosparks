import { describe, it, expect } from 'vitest';
import { judgeAnswer, formulateFollowUp, type FollowupReason } from '@/lib/interview/followup-engine';

describe('judgeAnswer', () => {
  it('passes a substantive, well-grounded answer', () => {
    const d = judgeAnswer({
      question: 'Why did X happen?',
      answer: 'X happened because the data showed a 40% drop in latency after the migration, according to our study.',
      priorClaims: [],
      knownEntities: [],
    });
    expect(d.needsFollowup).toBe(false);
    expect(d.reason).toBe('passed');
  });

  it('flags a vague quantifier with no number', () => {
    const d = judgeAnswer({
      question: 'How many users?',
      answer: '哦，挺多的，不少人都用。',
      priorClaims: [],
      knownEntities: [],
    });
    expect(d.needsFollowup).toBe(true);
    expect(d.reason).toBe('vague_quantifier');
  });

  it('lets a vague quantifier pass when a number IS present', () => {
    const d = judgeAnswer({
      question: 'How many?',
      answer: 'a lot — about 5000 active users',
      priorClaims: [],
      knownEntities: [],
    });
    expect(d.reason).toBe('passed');
  });

  it('flags a conclusion without any reasoning marker', () => {
    const d = judgeAnswer({
      question: 'What is your view?',
      answer: 'I think this whole approach is fundamentally misguided and will not scale to the size we need it to reach eventually.',
      priorClaims: [],
      knownEntities: [],
    });
    expect(d.needsFollowup).toBe(true);
    expect(d.reason).toBe('conclusion_no_basis');
  });

  it('flags a short answer to a substantive question (dodge)', () => {
    const d = judgeAnswer({
      question: 'Why did you change your mind?',
      answer: '嗯，不太好说。',
      priorClaims: [],
      knownEntities: [],
    });
    expect(d.needsFollowup).toBe(true);
    expect(d.reason).toBe('dodges_question');
  });

  it('flags a contradiction with a prior claim', () => {
    const d = judgeAnswer({
      question: 'Do you still support open source?',
      answer: 'No, I do not support open source anymore for this project.',
      priorClaims: [{ text: 'open source is the right model for infrastructure projects' }],
      knownEntities: [],
    });
    expect(d.needsFollowup).toBe(true);
    expect(d.reason).toBe('contradicts_prior');
  });

  it('flags an empty answer', () => {
    const d = judgeAnswer({ question: 'Tell me more', answer: '', priorClaims: [], knownEntities: [] });
    expect(d.reason).toBe('dodges_question');
  });
});

describe('formulateFollowUp', () => {
  it('produces a Chinese follow-up per reason', () => {
    const cases: Array<[FollowupReason, string]> = [
      ['vague_quantifier', '具体是多少'],
      ['conclusion_no_basis', '依据'],
      ['contradicts_prior', '变化'],
      ['dodges_question', '展开'],
      ['new_entity', '多讲讲'],
    ];
    for (const [reason, expected] of cases) {
      const q = formulateFollowUp(reason);
      expect(q).toContain(expected);
    }
  });
});
