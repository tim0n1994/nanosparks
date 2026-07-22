import { describe, it, expect } from 'vitest';
import {
  showKeyFromTitle,
  glossarySettingKey,
  validateGlossaryTerms,
} from '@/lib/transcription/hotwords';

describe('showKeyFromTitle', () => {
  it('slugifies a title into a stable key', () => {
    expect(showKeyFromTitle('Lex Fridman Podcast')).toBe('lex_fridman_podcast');
  });

  it('keeps CJK characters', () => {
    expect(showKeyFromTitle('硅谷101')).toBe('硅谷101');
  });

  it('falls back to default for empty/null titles', () => {
    expect(showKeyFromTitle('')).toBe('default');
    expect(showKeyFromTitle(null)).toBe('default');
    expect(showKeyFromTitle(undefined)).toBe('default');
  });

  it('caps length at 60 chars', () => {
    expect(showKeyFromTitle('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe('glossarySettingKey', () => {
  it('prefixes with glossary.', () => {
    expect(glossarySettingKey('My Show')).toBe('glossary.my_show');
  });
});

describe('validateGlossaryTerms', () => {
  it('accepts a valid wrong→right map', () => {
    const r = validateGlossaryTerms({ openai: 'OpenAI', gpt4: 'GPT-4' });
    expect(r.ok).toBe(true);
    expect(r.terms).toEqual({ openai: 'OpenAI', gpt4: 'GPT-4' });
  });

  it('rejects non-object input', () => {
    expect(validateGlossaryTerms(null).ok).toBe(false);
    expect(validateGlossaryTerms('string').ok).toBe(false);
  });

  it('rejects empty keys', () => {
    expect(validateGlossaryTerms({ '': 'x' }).ok).toBe(false);
    expect(validateGlossaryTerms({ '   ': 'x' }).ok).toBe(false);
  });

  it('rejects empty/non-string values', () => {
    expect(validateGlossaryTerms({ a: '' }).ok).toBe(false);
    expect(validateGlossaryTerms({ a: 123 as unknown }).ok).toBe(false);
  });

  it('rejects more than 200 terms', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 201; i++) big[`k${i}`] = 'v';
    expect(validateGlossaryTerms(big).ok).toBe(false);
  });

  it('trims whitespace in keys', () => {
    const r = validateGlossaryTerms({ '  openai  ': 'OpenAI' });
    expect(r.terms).toEqual({ openai: 'OpenAI' });
  });
});
