import { describe, it, expect } from 'vitest';
import { needsChunking, planChunks, offsetTimestamps, MAX_CHUNK_SEC, CHUNK_OVERLAP_SEC } from '@/lib/transcription/audio-chunker';

describe('needsChunking', () => {
  it('returns false for null duration (unknown — treat as single)', () => {
    expect(needsChunking(null)).toBe(false);
  });

  it('returns false for audio under 2h', () => {
    expect(needsChunking(3600)).toBe(false); // 1h
    expect(needsChunking(MAX_CHUNK_SEC)).toBe(false); // exactly 2h
  });

  it('returns true for audio over 2h', () => {
    expect(needsChunking(MAX_CHUNK_SEC + 1)).toBe(true);
    expect(needsChunking(5 * 3600)).toBe(true); // 5h
  });
});

describe('planChunks', () => {
  it('returns single chunk for audio under limit', () => {
    const chunks = planChunks(3600);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ startSec: 0, endSec: 3600, index: 0 });
  });

  it('returns single chunk for exactly 2h', () => {
    const chunks = planChunks(MAX_CHUNK_SEC);
    expect(chunks).toHaveLength(1);
  });

  it('splits a 5h audio into multiple chunks with overlap', () => {
    const chunks = planChunks(5 * 3600); // 18000s
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be ≤ MAX_CHUNK_SEC
    for (const c of chunks) {
      expect(c.endSec - c.startSec).toBeLessThanOrEqual(MAX_CHUNK_SEC);
    }
    // Chunks should have increasing start times
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startSec).toBeGreaterThan(chunks[i - 1].startSec);
    }
  });

  it('overlap is applied between consecutive chunks', () => {
    const chunks = planChunks(4 * 3600); // 14400s
    if (chunks.length > 1) {
      // Second chunk should start before first chunk ends (overlap)
      expect(chunks[1].startSec).toBeLessThan(chunks[0].endSec);
    }
  });

  it('last chunk ends at the total duration', () => {
    const dur = 3 * 3600; // 10800s
    const chunks = planChunks(dur);
    expect(chunks[chunks.length - 1].endSec).toBe(dur);
  });
});

describe('offsetTimestamps', () => {
  it('adds the offset to all timestamps', () => {
  const segments = [
      { startMs: 1000, endMs: 2000, text: 'hello' },
      { startMs: 3000, endMs: 4000, text: 'world' },
    ];
    const offset = offsetTimestamps(segments, 7200000); // 2h offset
    expect(offset[0].startMs).toBe(7201000);
    expect(offset[0].endMs).toBe(7202000);
    expect(offset[1].startMs).toBe(7203000);
  });

  it('adjusts word-level timestamps too', () => {
    const segments = [
      { startMs: 0, endMs: 100, text: 'hi', words: [{ startMs: 0, endMs: 50 }] as Array<{ startMs: number; endMs: number }> },
    ];
    const offset = offsetTimestamps(segments, 1000);
    expect((offset[0].words as Array<{ startMs: number; endMs: number }>)[0].startMs).toBe(1000);
  });

  it('preserves text and speakerLabel', () => {
    const segments = [
      { startMs: 0, endMs: 100, text: 'hi', speakerLabel: 'speaker_0' },
    ];
    const offset = offsetTimestamps(segments, 500);
    expect(offset[0].text).toBe('hi');
    expect(offset[0].speakerLabel).toBe('speaker_0');
  });
});
