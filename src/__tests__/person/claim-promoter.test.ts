import { describe, it, expect } from 'vitest';
import { normalizeStance, shouldPromoteToPersonClaim } from '@/lib/person/claim-promoter';

describe('normalizeStance', () => {
  it('maps argument-mining vocab to the PersonClaim set', () => {
    expect(normalizeStance('assert')).toBe('assert');
    expect(normalizeStance('support')).toBe('assert');
    expect(normalizeStance('agree')).toBe('assert');
    expect(normalizeStance('concede')).toBe('concede');
    expect(normalizeStance('oppose')).toBe('oppose');
    expect(normalizeStance('object')).toBe('oppose');
    expect(normalizeStance('question')).toBe('question');
    expect(normalizeStance('')).toBe('neutral');
    expect(normalizeStance(null)).toBe('neutral');
    expect(normalizeStance(undefined)).toBe('neutral');
  });

  it('normalizes case/whitespace', () => {
    expect(normalizeStance('  ASSERT ')).toBe('assert');
    expect(normalizeStance('Oppose')).toBe('oppose');
  });
});

describe('shouldPromoteToPersonClaim', () => {
  const base = { type: 'claim', stance: 'assert', participantId: 'p1', participantRole: 'guest', modality: null };

  it('promotes a guest asserting a claim', () => {
    expect(shouldPromoteToPersonClaim({ ...base })).toBe(true);
  });

  it('promotes insight type too', () => {
    expect(shouldPromoteToPersonClaim({ ...base, type: 'insight' })).toBe(true);
  });

  it('rejects non-claim types', () => {
    expect(shouldPromoteToPersonClaim({ ...base, type: 'question' })).toBe(false);
    expect(shouldPromoteToPersonClaim({ ...base, type: 'evidence' })).toBe(false);
    expect(shouldPromoteToPersonClaim({ ...base, type: 'objection' })).toBe(false);
  });

  it('rejects anonymous (no participant) TUs', () => {
    expect(shouldPromoteToPersonClaim({ ...base, participantId: null })).toBe(false);
    expect(shouldPromoteToPersonClaim({ ...base, participantId: undefined })).toBe(false);
  });

  it('rejects non-assert stances', () => {
    expect(shouldPromoteToPersonClaim({ ...base, stance: 'question' })).toBe(false);
    expect(shouldPromoteToPersonClaim({ ...base, stance: 'oppose' })).toBe(false);
    // An absent/neutral stance on a type=claim is treated as an assertion
    // (extraction often leaves stance empty; the type itself asserts).
    expect(shouldPromoteToPersonClaim({ ...base, stance: 'neutral' })).toBe(true);
    expect(shouldPromoteToPersonClaim({ ...base, stance: null })).toBe(true);
    expect(shouldPromoteToPersonClaim({ ...base, stance: '' })).toBe(true);
  });

  it('excludes host echoing the guest (modality=quoted)', () => {
    expect(shouldPromoteToPersonClaim({ ...base, participantRole: 'host', modality: 'quoted' })).toBe(false);
    // host's OWN assertion still promotes
    expect(shouldPromoteToPersonClaim({ ...base, participantRole: 'host', modality: 'asserted' })).toBe(true);
    // §7.2: quoted (any role quoting someone) is never the speaker's own stance
    expect(shouldPromoteToPersonClaim({ ...base, participantRole: 'guest', modality: 'quoted' })).toBe(false);
    // hypothetical/joking are likewise excluded (not a real position)
    expect(shouldPromoteToPersonClaim({ ...base, modality: 'hypothetical' })).toBe(false);
    expect(shouldPromoteToPersonClaim({ ...base, modality: 'joking' })).toBe(false);
  });
});

import { inferStanceFromText } from '@/lib/person/claim-promoter';
describe('inferStanceFromText (§7.2 stance inference)', () => {
  it('defaults a plain claim to assert', () => {
    expect(inferStanceFromText('开源是最好的模式', 'claim')).toBe('assert');
    expect(inferStanceFromText('AI will change everything', 'claim')).toBe('assert');
  });
  it('detects questions', () => {
    expect(inferStanceFromText('这真的可行吗？', 'claim')).toBe('question');
    expect(inferStanceFromText('是否能做到？', 'claim')).toBe('question');
  });
  it('detects opposition via negation markers', () => {
    expect(inferStanceFromText('这个方向不对', 'claim')).toBe('oppose');
    expect(inferStanceFromText('I disagree with this approach', 'claim')).toBe('oppose');
  });
  it('detects concession', () => {
    expect(inferStanceFromText('我以前也这么想，但现在改变了', 'claim')).toBe('concede');
  });
  it('treats hedging as assert not oppose', () => {
    expect(inferStanceFromText('not sure about this', 'claim')).toBe('assert');
  });
  it('bare 不/negation inside an ordinary assertion is NOT opposition (anti-char-frequency regression)', () => {
    // The old /不|错|never/ regex classified ~a third of Chinese assertions as
    // oppose, turning the corpus stance distribution into character-frequency noise.
    expect(inferStanceFromText('两种方案效果差不多', 'claim')).toBe('assert');
    expect(inferStanceFromText('这不是一个真正的问题', 'claim')).toBe('assert');
    expect(inferStanceFromText('AI 未必会取代人类工程师', 'claim')).toBe('assert');
    expect(inferStanceFromText('创业公司不应该过早融资', 'claim')).toBe('assert');
    expect(inferStanceFromText('信息是不对称的', 'claim')).toBe('assert');
  });
  it('explicit disagreement still detected', () => {
    expect(inferStanceFromText('我反对这种做法', 'claim')).toBe('oppose');
    expect(inferStanceFromText('我不认同这个判断', 'claim')).toBe('oppose');
    expect(inferStanceFromText('这种说法是错误的', 'claim')).toBe('oppose');
  });
});
