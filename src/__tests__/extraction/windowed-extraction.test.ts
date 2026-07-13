import { describe, it, expect } from 'vitest';
import { createWindows, mergeExtractions } from '@/lib/extraction/windowed-extraction';
import type { ThoughtUnitInput } from '@/types/domain';

describe('createWindows', () => {
  it('splits on speaker change', () => {
    const turns = [
      { turnIndex: 0, startMs: 0, endMs: 5000, text: 'Hello world', speakerLabel: 'SPEAKER_00' },
      { turnIndex: 1, startMs: 5000, endMs: 10000, text: 'Hi there', speakerLabel: 'SPEAKER_01' },
    ];

    const windows = createWindows(turns);
    expect(windows).toHaveLength(2);
    expect(windows[0].speakers).toEqual(['SPEAKER_00']);
    expect(windows[1].speakers).toEqual(['SPEAKER_01']);
  });

  it('keeps same-speaker turns in one window', () => {
    const turns = [
      { turnIndex: 0, startMs: 0, endMs: 3000, text: 'word1', speakerLabel: 'SPEAKER_00' },
      { turnIndex: 1, startMs: 3000, endMs: 6000, text: 'word2', speakerLabel: 'SPEAKER_00' },
    ];

    const windows = createWindows(turns);
    expect(windows).toHaveLength(1);
    expect(windows[0].turnIndices).toEqual([0, 1]);
  });

  it('splits when max duration exceeded', () => {
    const turns = [
      { turnIndex: 0, startMs: 0, endMs: 300000, text: 'long talk', speakerLabel: 'SPEAKER_00' },
      { turnIndex: 1, startMs: 300000, endMs: 600000, text: 'more talk', speakerLabel: 'SPEAKER_00' },
    ];

    const windows = createWindows(turns, { maxWindowDurationMs: 300000 });
    expect(windows.length).toBeGreaterThan(1);
  });

  it('splits when max chars exceeded', () => {
    const longText = 'a'.repeat(5000);
    const turns = [
      { turnIndex: 0, startMs: 0, endMs: 10000, text: longText, speakerLabel: 'SPEAKER_00' },
      { turnIndex: 1, startMs: 10000, endMs: 20000, text: longText, speakerLabel: 'SPEAKER_00' },
    ];

    const windows = createWindows(turns, { maxWindowChars: 8000 });
    expect(windows.length).toBeGreaterThan(1);
  });

  it('handles empty turns', () => {
    const windows = createWindows([]);
    expect(windows).toEqual([]);
  });
});

describe('mergeExtractions', () => {
  it('deduplicates by text', () => {
    const tu: ThoughtUnitInput = {
      type: 'claim',
      text: 'AI is important',
      confidence: 0.9,
      evidenceSpans: [{ startMs: 0, endMs: 1000, quote: 'AI is important' }],
    };

    const results = [
      { windowIndex: 0, thoughtUnits: [tu] },
      { windowIndex: 1, thoughtUnits: [{ ...tu, confidence: 0.7 }] },
    ];

    const merged = mergeExtractions(results);
    expect(merged.thoughtUnits).toHaveLength(1);
    expect(merged.thoughtUnits[0].confidence).toBe(0.9); // keeps higher confidence
    expect(merged.thoughtUnits[0].sourceWindows).toEqual([0, 1]);
  });

  it('finds cross-window relations', () => {
    const results = [
      {
        windowIndex: 0,
        thoughtUnits: [
          { type: 'claim' as const, text: 'AI alignment is important for safety', confidence: 0.9, evidenceSpans: [] },
        ],
      },
      {
        windowIndex: 1,
        thoughtUnits: [
          { type: 'claim' as const, text: 'AI alignment is not important for safety', confidence: 0.8, evidenceSpans: [] },
        ],
      },
    ];

    const merged = mergeExtractions(results);
    expect(merged.relations.length).toBeGreaterThan(0);
    expect(merged.relations.some((r) => r.relation === 'contradicts')).toBe(true);
  });

  it('assigns cluster IDs', () => {
    const results = [
      {
        windowIndex: 0,
        thoughtUnits: [
          { type: 'claim' as const, text: 'Climate change is real', confidence: 0.9, evidenceSpans: [] },
          { type: 'claim' as const, text: 'Climate change is real and accelerating', confidence: 0.8, evidenceSpans: [] },
        ],
      },
    ];

    const merged = mergeExtractions(results);
    expect(merged.thoughtUnits.every((tu) => tu.clusterId !== undefined)).toBe(true);
  });

  it('handles empty results', () => {
    const merged = mergeExtractions([]);
    expect(merged.thoughtUnits).toEqual([]);
    expect(merged.relations).toEqual([]);
  });
});
