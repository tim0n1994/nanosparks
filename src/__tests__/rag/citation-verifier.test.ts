import { describe, it, expect } from 'vitest';
import {
  extractCitations,
  verifyCitations,
  stripUnverifiedCitations,
} from '@/lib/rag/citation-verifier';
import type { SearchResult } from '@/lib/rag/hybrid-search';

function makeResult(id: string): SearchResult {
  return {
    thoughtUnitId: id,
    text: `text for ${id}`,
    type: 'claim',
    conversationId: 'conv1',
    score: 0.5,
  };
}

describe('extractCitations', () => {
  it('extracts single citations [1]', () => {
    expect(extractCitations('This is a claim [1] about something.')).toEqual([1]);
  });

  it('extracts multiple citations [1] [2]', () => {
    expect(extractCitations('Claim [1] and [2] support this.')).toEqual([1, 2]);
  });

  it('extracts comma-separated [1,3]', () => {
    expect(extractCitations('See [1,3] for details.')).toEqual([1, 3]);
  });

  it('extracts ranges [1-3]', () => {
    expect(extractCitations('References [1-3] are relevant.')).toEqual([1, 2, 3]);
  });

  it('returns empty when no citations', () => {
    expect(extractCitations('No citations here.')).toEqual([]);
  });

  it('deduplicates', () => {
    expect(extractCitations('See [1] and [1] again.')).toEqual([1]);
  });
});

describe('verifyCitations', () => {
  it('verifies citations that have matching candidates', () => {
    const candidates = [makeResult('tu1'), makeResult('tu2'), makeResult('tu3')];
    const result = verifyCitations('Claim [1] and [2] support this.', candidates);

    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].verified).toBe(true);
    expect(result.citations[0].thoughtUnitId).toBe('tu1');
    expect(result.citations[1].verified).toBe(true);
    expect(result.verifiedCount).toBe(2);
    expect(result.unverifiedCount).toBe(0);
  });

  it('flags citations beyond candidate count', () => {
    const candidates = [makeResult('tu1')];
    const result = verifyCitations('See [1] and [5].', candidates);

    expect(result.verifiedCount).toBe(1);
    expect(result.unverifiedCount).toBe(1);
    expect(result.citations[1].verified).toBe(false);
    expect(result.citations[1].reason).toContain('no matching candidate');
  });

  it('handles answer with no citations', () => {
    const result = verifyCitations('Plain answer.', [makeResult('tu1')]);
    expect(result.citations).toEqual([]);
    expect(result.verifiedCount).toBe(0);
  });
});

describe('stripUnverifiedCitations', () => {
  it('replaces unverified citations with [unverified]', () => {
    const candidates = [makeResult('tu1')];
    const result = stripUnverifiedCitations('See [1] and [5].', candidates);
    expect(result).toBe('See [1] and [unverified].');
  });

  it('leaves verified citations intact', () => {
    const candidates = [makeResult('tu1'), makeResult('tu2')];
    const result = stripUnverifiedCitations('See [1] and [2].', candidates);
    expect(result).toBe('See [1] and [2].');
  });

  it('handles no unverified citations', () => {
    const candidates = [makeResult('tu1')];
    const result = stripUnverifiedCitations('See [1].', candidates);
    expect(result).toBe('See [1].');
  });
});
