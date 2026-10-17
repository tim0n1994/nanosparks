import { describe, expect, it } from 'vitest';
import { createEvidenceCoordinateResolver, normalizeEvidenceSpans, type EvidenceCoordinateTurn } from '@/lib/extraction/evidence-coordinates';

const turn = (turnIndex: number, text: string): EvidenceCoordinateTurn => ({
  turnIndex, text, startMs: turnIndex * 1000, endMs: turnIndex * 1000 + 900,
});

describe('normalizeEvidenceSpans', () => {
  it('replaces wrong model indices and invented times with global source bounds', () => {
    expect(normalizeEvidenceSpans([
      { quote: 'Education needs better evidence', turnIndex: 2, startMs: 5, endMs: 6 },
    ], [turn(400, 'Education needs better evidence.')])).toEqual([
      { quote: 'Education needs better evidence', turnIndex: 400, startMs: 400000, endMs: 400900 },
    ]);
  });

  it('matches full-width English, case, punctuation and repeated whitespace', () => {
    expect(normalizeEvidenceSpans([{ quote: 'ｅｖｉｄｅｎｃｅ—SUPPORTS\n better decisions!' }], [
      turn(10, 'Evidence supports, better decisions.'),
    ])[0]?.turnIndex).toBe(10);
  });

  it('preserves Chinese characters while normalizing punctuation and whitespace', () => {
    expect(normalizeEvidenceSpans([{ quote: '人工智能， 改变教育。' }], [
      turn(50, '我们相信人工智能改变教育，而且需要验证。'),
    ])[0]?.turnIndex).toBe(50);
  });

  it('rejects a quote repeated across turns even when the model supplies a matching index', () => {
    expect(normalizeEvidenceSpans([{ quote: 'Evidence supports better decisions', turnIndex: 1 }], [
      turn(1, 'Evidence supports better decisions.'), turn(2, 'Evidence supports better decisions.'),
    ])).toEqual([]);
  });

  it('rejects repeated occurrences inside the same turn', () => {
    expect(normalizeEvidenceSpans([{ quote: '重复引用无法定位', turnIndex: 1 }], [
      turn(1, '重复引用无法定位，然后重复引用无法定位。'),
    ])).toEqual([]);
  });

  it('supports a unique quote across adjacent turns using full source turn bounds', () => {
    expect(normalizeEvidenceSpans([{ quote: 'supports better decisions across teams' }], [
      turn(10, 'Evidence supports better'), turn(11, 'decisions across teams every day.'),
    ])).toEqual([{ quote: 'supports better decisions across teams', turnIndex: 10, startMs: 10000, endMs: 11900 }]);
  });

  it('supports Chinese quotes across adjacent turns without artificial spaces', () => {
    expect(normalizeEvidenceSpans([{ quote: '人工智能改变教育' }], [
      turn(10, '人工智能'), turn(11, '改变教育'),
    ])[0]).toEqual({ quote: '人工智能改变教育', turnIndex: 10, startMs: 10000, endMs: 11900 });
  });

  it.each([
    [turn(10, 'Evidence supports better'), turn(12, 'decisions across teams.')],
    [turn(10, 'Evidence supports better'), turn(11, ''), turn(12, 'decisions across teams.')],
  ])('does not stitch across missing or empty turns', (...turns) => {
    expect(normalizeEvidenceSpans([{ quote: 'supports better decisions across teams' }], turns)).toEqual([]);
  });

  it('rejects empty, missing, short common, fabricated and partial-word quotes', () => {
    expect(normalizeEvidenceSpans([
      {}, { quote: null }, { quote: '' }, { quote: 'thank you' }, { quote: '是的' },
      { quote: 'This was never said', turnIndex: 1 }, { quote: 'vidence supports better decision' },
    ], [turn(1, 'Thank you. 是的。Evidence supports better decisions.')])).toEqual([]);
  });

  it('does not conflate separate Latin words with a single word', () => {
    expect(normalizeEvidenceSpans([{ quote: 'The therapist arrived early' }], [
      turn(1, 'The the rapist arrived early'),
    ])).toEqual([]);
  });

  it('rejects duplicated source indices and invalid source times', () => {
    expect(normalizeEvidenceSpans([{ quote: 'Evidence supports better decisions' }], [
      turn(1, 'Evidence supports better decisions'), turn(1, 'Another valid source sentence'),
    ])).toEqual([]);
    expect(normalizeEvidenceSpans([{ quote: 'Evidence supports better decisions' }], [
      { ...turn(1, 'Evidence supports better decisions'), startMs: NaN },
    ])).toEqual([]);
  });

  it('handles absent sources and repeated candidate quotes without changing coordinates', () => {
    expect(normalizeEvidenceSpans(undefined, [turn(1, 'Valid source text')])).toEqual([]);
    expect(normalizeEvidenceSpans([{ quote: 'Valid source text' }], [])).toEqual([]);
    const result = normalizeEvidenceSpans([
      { quote: 'Evidence supports better decisions' }, { quote: 'Evidence supports better decisions!' },
    ], [turn(50, 'Evidence supports better decisions')]);
    expect(result).toHaveLength(2);
    expect(result.map((span) => span.turnIndex)).toEqual([50, 50]);
  });

  it('resolves repeatedly from an immutable source snapshot', () => {
    const source = [turn(50, 'Evidence supports better decisions')];
    const resolve = createEvidenceCoordinateResolver(source);
    source[0].startMs = 1;
    source[0].text = 'This text has been replaced';
    expect(resolve([{ quote: 'Evidence supports better decisions' }])[0]?.startMs).toBe(50000);
    expect(resolve([{ quote: 'This text has been replaced' }])).toEqual([]);
    expect(resolve(undefined)).toEqual([]);
  });

  it.each([1.5, -1, Number.POSITIVE_INFINITY, 2_147_483_648])('rejects invalid database timestamp %s', (startMs) => {
    expect(normalizeEvidenceSpans([{ quote: 'Evidence supports better decisions' }], [
      { ...turn(1, 'Evidence supports better decisions'), startMs, endMs: startMs + 1 },
    ])).toEqual([]);
  });

  it('does not stitch adjacent indices whose source times run backwards', () => {
    expect(normalizeEvidenceSpans([{ quote: 'supports better decisions across teams' }], [
      turn(10, 'Evidence supports better'),
      { ...turn(11, 'decisions across teams'), startMs: 9000, endMs: 9900 },
    ])).toEqual([]);
  });
});
