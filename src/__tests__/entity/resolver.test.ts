import { describe, it, expect } from 'vitest';
import {
  normalizeEntityName,
  normalizeEntityType,
  matchesExisting,
  type EntityCandidate,
} from '@/lib/entity/resolver';

describe('normalizeEntityName', () => {
  it('lowercases, strips punctuation and whitespace', () => {
    expect(normalizeEntityName('Open AI, Inc.!')).toBe('openaiinc');
    expect(normalizeEntityName('  OpenAI ')).toBe('openai');
    expect(normalizeEntityName('苹果公司')).toBe('苹果公司');
  });

  it('normalizes fullwidth/halfwidth via NFKC', () => {
    // fullwidth Ｏ to ASCII O
    expect(normalizeEntityName('ＯｐｅｎＡＩ')).toBe('openai');
  });

  it('empty input → empty string', () => {
    expect(normalizeEntityName('')).toBe('');
    expect(normalizeEntityName(undefined)).toBe('');
  });
});

describe('normalizeEntityType', () => {
  it('passes known types through', () => {
    expect(normalizeEntityType('person')).toBe('person');
    expect(normalizeEntityType('ORG')).toBe('org');
  });

  it('maps synonyms in en + zh, defaults to concept', () => {
    expect(normalizeEntityType('company')).toBe('org');
    expect(normalizeEntityType('人物')).toBe('person');
    expect(normalizeEntityType('机构')).toBe('org');
    expect(normalizeEntityType('产品')).toBe('product');
    expect(normalizeEntityType('garbageXYZ')).toBe('concept');
  });
});

describe('matchesExisting (L1 exact/alias)', () => {
  const cand = (canonicalGuess: string, surfaceForm = canonicalGuess): EntityCandidate => ({
    surfaceForm,
    type: 'org',
    canonicalGuess,
  });

  it('matches an existing canonical name regardless of punctuation/case', () => {
    expect(
      matchesExisting(cand('Open AI'), { canonicalName: 'OpenAI', aliasesJson: [] }),
    ).toBe(true);
    expect(
      matchesExisting(cand('openai'), { canonicalName: 'Open-AI', aliasesJson: [] }),
    ).toBe(true);
  });

  it('matches via a known alias', () => {
    expect(
      matchesExisting(cand('ChatGPT'), { canonicalName: 'OpenAI', aliasesJson: ['Chat GPT', 'GPT'] }),
    ).toBe(true);
  });

  it('does NOT match a different entity of the same type', () => {
    expect(
      matchesExisting(cand('Anthropic'), { canonicalName: 'OpenAI', aliasesJson: ['GPT'] }),
    ).toBe(false);
  });

  it('returns false for empty candidate', () => {
    expect(matchesExisting(cand(''), { canonicalName: 'OpenAI', aliasesJson: [] })).toBe(false);
  });
});
