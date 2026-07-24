import { describe, it, expect } from 'vitest';
import { resolveParticipant, normalizeStance, buildParticipantIndex } from '@/lib/extraction/attribution';

const participants = [
  { id: 'p1', name: '张三', speakerLabel: 'SPEAKER_00' },
  { id: 'p2', name: '李四', speakerLabel: 'SPEAKER_01' },
  { id: 'p3', name: 'Naval Ravikant', speakerLabel: 's1' },
];

describe('resolveParticipant', () => {
  it('matches by exact speakerLabel', () => {
    expect(resolveParticipant('SPEAKER_00', participants)).toBe('p1');
    expect(resolveParticipant('s1', participants)).toBe('p3');
  });

  it('matches by exact name', () => {
    expect(resolveParticipant('张三', participants)).toBe('p1');
    expect(resolveParticipant('Naval Ravikant', participants)).toBe('p3');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveParticipant('  speaker_00 ', participants)).toBe('p1');
    expect(resolveParticipant(' naval ravikant', participants)).toBe('p3');
  });

  it('canonicalizes ASR prefixes (spk_ → speaker)', () => {
    expect(resolveParticipant('SPK_00', participants)).toBe('p1');
  });

  it('returns null for no match instead of guessing', () => {
    expect(resolveParticipant('Nobody', participants)).toBeNull();
    expect(resolveParticipant('王五', participants)).toBeNull();
  });

  it('returns null for empty / undefined label', () => {
    expect(resolveParticipant('', participants)).toBeNull();
    expect(resolveParticipant(undefined, participants)).toBeNull();
    expect(resolveParticipant('张三', [])).toBeNull();
  });

  it('does not collide on single-char labels', () => {
    // "1" is too short and must not substring-match "s1".
    expect(resolveParticipant('1', participants)).toBeNull();
  });

  it('prefix match resolves a partial name', () => {
    expect(resolveParticipant('Naval', participants)).toBe('p3');
  });
});

describe('normalizeStance', () => {
  it('passes canonical stances through', () => {
    expect(normalizeStance('assert')).toBe('assert');
    expect(normalizeStance('oppose')).toBe('oppose');
    expect(normalizeStance('question')).toBe('question');
    expect(normalizeStance('concede')).toBe('concede');
    expect(normalizeStance('neutral')).toBe('neutral');
  });

  it('maps English synonyms', () => {
    expect(normalizeStance('disagree')).toBe('oppose');
    expect(normalizeStance('refute')).toBe('oppose');
    expect(normalizeStance('support')).toBe('assert');
    expect(normalizeStance('wonder')).toBe('question');
  });

  it('maps Chinese stances', () => {
    expect(normalizeStance('反驳')).toBe('oppose');
    expect(normalizeStance('质疑')).toBe('question');
    expect(normalizeStance('中立陈述')).toBe('neutral');
    expect(normalizeStance('他认为')).toBe('assert');
  });

  it('returns null for unknown / empty', () => {
    expect(normalizeStance('')).toBeNull();
    expect(normalizeStance(undefined)).toBeNull();
    expect(normalizeStance('gibberishXYZ')).toBeNull();
  });
});

describe('buildParticipantIndex', () => {
  it('maps both name and speakerLabel keys', () => {
    const idx = buildParticipantIndex(participants);
    expect(idx.get('张三')).toBe('p1');
    expect(idx.get('speaker_00')).toBe('p1');
    expect(idx.get('naval ravikant')).toBe('p3');
  });
});
