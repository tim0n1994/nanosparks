import { describe, expect, it } from 'vitest';
import { parseLenientJson, salvageTruncatedJson } from '@/lib/llm/client';
import { windowMinCoverage } from '@/lib/extraction/windowed-extraction';

describe('salvageTruncatedJson (2026-10-19: recover output-capped windows)', () => {
  it('recovers the complete prefix of a truncated array of objects', () => {
    expect(JSON.parse(salvageTruncatedJson('{"thoughtUnits":[{"a":1},{"b":2')!)).toEqual({ thoughtUnits: [{ a: 1 }] });
  });

  it('drops a partially written object but keeps its complete siblings', () => {
    expect(JSON.parse(salvageTruncatedJson('[{"x":"a,b"},{"y":')!)).toEqual([{ x: 'a,b' }]);
    expect(JSON.parse(salvageTruncatedJson('[{"s":"he said \\"}\\" ok"},{"t":1')!)).toEqual([{ s: 'he said "}" ok' }]);
  });

  it('closes an empty container when its first element was truncated', () => {
    expect(JSON.parse(salvageTruncatedJson('{"a":[{"x":1},{"y":2')!)).toEqual({ a: [{ x: 1 }] });
    expect(JSON.parse(salvageTruncatedJson('[[{"x":1},{"y"')!)).toEqual([[{ x: 1 }]]);
  });

  it('ignores prose and fences before the JSON anchor', () => {
    expect(JSON.parse(salvageTruncatedJson('Sure! Here you go:\n```json\n{"thoughtUnits":[{"a":1},{"b"')!)).toEqual({ thoughtUnits: [{ a: 1 }] });
  });

  it('returns null for balanced or unrecoverable input', () => {
    expect(salvageTruncatedJson('{"a":[1,2]}')).toBeNull();
    expect(salvageTruncatedJson('no json here')).toBeNull();
    expect(salvageTruncatedJson('{"a"')).toBeNull();
  });
});

describe('parseLenientJson salvage hook', () => {
  it('parses fenced JSON with prose around it', () => {
    expect(parseLenientJson('Sure! ```json\n[1,2]\n```')).toEqual([1, 2]);
  });

  it('recovers a truncated thought_units payload instead of throwing', () => {
    const truncated = '{"thoughtUnits":[{"type":"claim","text":"first"},{"type":"claim","text":"sec';
    expect(parseLenientJson(truncated)).toEqual({ thoughtUnits: [{ type: 'claim', text: 'first' }] });
  });
});

describe('windowMinCoverage', () => {
  it('defaults to 0.9 and clamps invalid overrides', () => {
    const prev = process.env.NSP_WINDOW_MIN_COVERAGE;
    try {
      delete process.env.NSP_WINDOW_MIN_COVERAGE;
      expect(windowMinCoverage()).toBe(0.9);
      process.env.NSP_WINDOW_MIN_COVERAGE = '0.75';
      expect(windowMinCoverage()).toBe(0.75);
      process.env.NSP_WINDOW_MIN_COVERAGE = '5';
      expect(windowMinCoverage()).toBe(0.9);
    } finally {
      if (prev === undefined) delete process.env.NSP_WINDOW_MIN_COVERAGE;
      else process.env.NSP_WINDOW_MIN_COVERAGE = prev;
    }
  });
});
