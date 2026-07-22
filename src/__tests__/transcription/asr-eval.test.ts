import { describe, it, expect } from 'vitest';
import { tokenize, editDistance, wer, der, evaluateFixture } from '@/lib/transcription/asr-eval';

describe('tokenize', () => {
  it('splits CJK into per-char tokens', () => {
    expect(tokenize('大家好')).toEqual(['大', '家', '好']);
  });

  it('keeps ascii words whole', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world']);
  });

  it('handles mixed CJK + ascii', () => {
    expect(tokenize('使用 OpenAI')).toEqual(['使', '用', 'OpenAI']);
  });

  it('returns empty for empty/whitespace input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('editDistance', () => {
  it('is 0 for identical arrays', () => {
    expect(editDistance(['a', 'b'], ['a', 'b'])).toBe(0);
  });

  it('counts single substitution', () => {
    expect(editDistance(['a', 'b'], ['a', 'c'])).toBe(1);
  });

  it('counts insertion', () => {
    expect(editDistance(['a'], ['a', 'b'])).toBe(1);
  });

  it('is len for empty vs non-empty', () => {
    expect(editDistance([], ['a', 'b', 'c'])).toBe(3);
  });
});

describe('wer', () => {
  it('is 0 for perfect match', () => {
    expect(wer('大家好', '大家好')).toBe(0);
  });

  it('is 1 for completely wrong (same length)', () => {
    expect(wer('abc', 'xyz')).toBe(1);
  });

  it('is between 0 and 1 for partial match', () => {
 const r = wer('大家好今天', '大家好明天'); // 1 char wrong of 5
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.5);
  });

  it('returns 0 when both empty', () => {
    expect(wer('', '')).toBe(0);
  });
});

describe('der', () => {
  it('is 0 for perfect speaker overlap', () => {
    const ref = [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }];
    const hyp = [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }];
    expect(der(ref, hyp)).toBe(0);
  });

  it('is 1 when speaker labels differ for whole segment', () => {
    const ref = [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }];
    const hyp = [{ startMs: 0, endMs: 1000, speakerLabel: 'B' }];
    expect(der(ref, hyp)).toBe(1);
  });

  it('counts missed speech (ref has speech, hyp silent)', () => {
    const ref = [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }];
    expect(der(ref, [])).toBe(1);
  });

  it('counts false alarm (hyp speech where ref silent)', () => {
    const ref = [{ startMs: 0, endMs: 500, speakerLabel: 'A' }];
    const hyp = [
      { startMs: 0, endMs: 500, speakerLabel: 'A' },
      { startMs: 500, endMs: 1000, speakerLabel: 'A' }, // FA: 500ms extra
    ];
    // totalRef = 500; FA = 500; DER = 500/500 = 1
    expect(der(ref, hyp)).toBe(1);
  });

  it('returns 0 when reference is empty', () => {
    expect(der([], [{ startMs: 0, endMs: 100, speakerLabel: 'A' }])).toBe(0);
  });
});

describe('evaluateFixture', () => {
  it('returns both WER and DER', () => {
    const r = evaluateFixture({
      referenceText: '大家好',
      hypothesisText: '大家好',
      referenceSpeakers: [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }],
      hypothesisSpeakers: [{ startMs: 0, endMs: 1000, speakerLabel: 'A' }],
    });
    expect(r.wer).toBe(0);
    expect(r.der).toBe(0);
  });
});
