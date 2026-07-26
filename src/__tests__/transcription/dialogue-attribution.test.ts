import { describe, it, expect } from 'vitest';
import { isResponseTurn, isQuestionTurn, dialogueAttribution } from '@/lib/transcription/dialogue-attribution';
import { fuseDiarizationAndDialogue, applyLlmVerdict } from '@/lib/transcription/attribution-arbiter';

describe('isResponseTurn / isQuestionTurn', () => {
  it('detects backchannel responses', () => {
    expect(isResponseTurn('对')).toBe(true);
    expect(isResponseTurn('嗯，是的')).toBe(true);
    expect(isResponseTurn('right, exactly')).toBe(true);
  });
  it('rejects long turns as responses', () => {
    expect(isResponseTurn('对，我觉得这个问题的核心其实在于...这是一个很长的回答')).toBe(false);
  });
  it('detects questions', () => {
    expect(isQuestionTurn('你怎么看？')).toBe(true);
    expect(isQuestionTurn('What is X')).toBe(true);
    expect(isQuestionTurn('这是一个陈述句。')).toBe(false);
  });
});

describe('dialogueAttribution', () => {
  const speakers = ['SPEAKER_00', 'SPEAKER_01'];
  it('attributes a response turn to the listener (other speaker)', () => {
    const turns = [
      { text: '你觉得这个方向对吗？', role: 'host' as const, diarizationLabel: 'SPEAKER_00', startMs: 0, endMs: 3000 },
      { text: '对', role: 'guest' as const, diarizationLabel: null, startMs: 3000, endMs: 3500 },
    ];
    const hints = dialogueAttribution(turns, speakers);
    // response '对' → listener = the OTHER speaker of prev (SPEAKER_00) = SPEAKER_01
    expect(hints[1].label).toBe('SPEAKER_01');
    expect(hints[1].reason).toBe('response_to_prev');
  });
  it('marks after-question switch', () => {
    const turns = [
      { text: 'why did you do that?', role: null, diarizationLabel: 'SPEAKER_00', startMs: 0, endMs: 2000 },
      { text: 'well the reason is complicated and involves several factors', role: null, diarizationLabel: null, startMs: 2000, endMs: 8000 },
    ];
    const hints = dialogueAttribution(turns, speakers);
    expect(hints[1].reason).toBe('after_question_switch');
    expect(hints[1].label).toBe('SPEAKER_01');
  });
});

describe('fuseDiarizationAndDialogue (three-source fusion)', () => {
  it('A and B agree → diarization, 0.95, no LLM', () => {
    const r = fuseDiarizationAndDialogue({ label: 'SPEAKER_00', confidence: 0.9 }, { label: 'SPEAKER_00', confidence: 0.7, reason: 'response_to_prev' });
    expect(r.method).toBe('diarization');
    expect(r.confidence).toBe(0.95);
    expect(r.needsLlm).toBe(false);
  });
  it('A and B conflict → needs LLM', () => {
    const r = fuseDiarizationAndDialogue({ label: 'SPEAKER_00', confidence: 0.9 }, { label: 'SPEAKER_01', confidence: 0.7, reason: 'response_to_prev' });
    expect(r.needsLlm).toBe(true);
  });
  it('A missing, B present → dialogue', () => {
    const r = fuseDiarizationAndDialogue(null, { label: 'SPEAKER_01', confidence: 0.65, reason: 'after_question_switch' });
    expect(r.method).toBe('dialogue');
    expect(r.label).toBe('SPEAKER_01');
  });
  it('A and B both absent → none (visible null)', () => {
    const r = fuseDiarizationAndDialogue(null, { confidence: 0, reason: 'none' });
    expect(r.method).toBe('none');
    expect(r.label).toBeUndefined();
  });
});

describe('applyLlmVerdict', () => {
  it('accepts a high-confidence LLM label', () => {
    const base = { method: 'llm' as const, confidence: 0, needsLlm: true };
    const r = applyLlmVerdict(base, { label: 'SPEAKER_01', confidence: 0.85 });
    expect(r.method).toBe('llm');
    expect(r.label).toBe('SPEAKER_01');
  });
  it('records none when LLM is uncertain (<0.5)', () => {
    const r = applyLlmVerdict({ method: 'llm' as const, confidence: 0, needsLlm: true }, { confidence: 0.3 });
    expect(r.method).toBe('none');
    expect(r.label).toBeUndefined();
  });
});

import { extractGlossaryCandidates } from '@/lib/transcription/hotwords';
describe('extractGlossaryCandidates (§5.5 term growth)', () => {
  it('extracts Latin proper nouns and CJK runs', () => {
    const c = extractGlossaryCandidates(['Marc Andreessen spoke about AGI', '柯丽一鸣今天来了']);
    expect(c).toContain('Marc');
    expect(c).toContain('Andreessen');
    expect(c.some((w) => w.includes('柯丽') || w.includes('一鸣'))).toBe(true);
  });
});
