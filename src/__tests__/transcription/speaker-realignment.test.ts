import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSpeakerMapFromOverlaps,
  relabelChunk,
  resetGlobalCounter,
  type ChunkOverlap,
} from '@/lib/transcription/speaker-realignment';
import {
  buildSpeakerMappingPrompt,
  parseSpeakerMappingResponse,
  buildSpeakerMapWithLLM,
} from '@/lib/transcription/speaker-realignment';
import { vi } from 'vitest';
import type { TranscriptSegment } from '@/types/domain';

function seg(startMs: number, endMs: number, label: string, text = 'x'): TranscriptSegment {
  return { startMs, endMs, text, speakerLabel: label };
}

beforeEach(() => resetGlobalCounter());

describe('buildSpeakerMapFromOverlaps', () => {
  it('passes chunk 0 labels through unchanged', () => {
    const overlaps: ChunkOverlap[] = [
      { chunkIndex: 0, segments: [seg(0, 1000, 'speaker_0')] },
    ];
    const map = buildSpeakerMapFromOverlaps(overlaps);
    expect(map[0]).toEqual({});
  });

  it('maps chunk-1 local labels to chunk-0 global labels via overlap co-occurrence', () => {
    const overlaps: ChunkOverlap[] = [
      {
        chunkIndex: 0,
        segments: [
          seg(9000, 10000, 'speaker_0'), // overlaps chunk 1's window
          seg(10500, 11500, 'speaker_1'),
        ],
      },
      {
        chunkIndex: 1,
        segments: [
          seg(9050, 10050, 'speaker_A'), // near chunk0 speaker_0
          seg(10550, 11550, 'speaker_B'), // near chunk0 speaker_1
        ],
      },
    ];
    const map = buildSpeakerMapFromOverlaps(overlaps);
    expect(map[1]['speaker_A']).toBe('speaker_0');
    expect(map[1]['speaker_B']).toBe('speaker_1');
  });

  it('assigns new global labels to unmatched next-chunk speakers', () => {
    const overlaps: ChunkOverlap[] = [
      { chunkIndex: 0, segments: [seg(0, 1000, 'speaker_0')] },
      {
        chunkIndex: 1,
        segments: [seg(5000, 6000, 'speaker_X')], // no overlap match with chunk 0
      },
    ];
    const map = buildSpeakerMapFromOverlaps(overlaps);
    expect(map[1]['speaker_X']).toMatch(/^speaker_g_\d+$/);
  });

  it('tolerates small time drift within the tolerance window', () => {
    const overlaps: ChunkOverlap[] = [
      { chunkIndex: 0, segments: [seg(10000, 11000, 'speaker_0')] },
      { chunkIndex: 1, segments: [seg(10050, 11050, 'speaker_Z')] },
    ];
    const map = buildSpeakerMapFromOverlaps(overlaps, { timeToleranceMs: 1000 });
    expect(map[1]['speaker_Z']).toBe('speaker_0');
  });

  it('does not match when segments are far apart', () => {
    const overlaps: ChunkOverlap[] = [
      { chunkIndex: 0, segments: [seg(10000, 11000, 'speaker_0')] },
      { chunkIndex: 1, segments: [seg(20000, 21000, 'speaker_Z')] },
    ];
    const map = buildSpeakerMapFromOverlaps(overlaps, { timeToleranceMs: 500 });
    expect(map[1]['speaker_Z']).not.toBe('speaker_0');
  });
});

describe('relabelChunk', () => {
  it('rewrites local labels to their mapped global labels', () => {
    const segments = [seg(0, 1000, 'speaker_A'), seg(1000, 2000, 'speaker_B')];
    const out = relabelChunk(segments, { speaker_A: 'speaker_0', speaker_B: 'speaker_1' });
    expect(out[0].speakerLabel).toBe('speaker_0');
    expect(out[1].speakerLabel).toBe('speaker_1');
  });

  it('leaves segments unchanged when the map is empty', () => {
    const segments = [seg(0, 1000, 'speaker_A')];
    expect(relabelChunk(segments, {})[0].speakerLabel).toBe('speaker_A');
  });

  it('preserves unmapped labels as-is', () => {
    const segments = [seg(0, 1000, 'speaker_A'), seg(1000, 2000, 'speaker_C')];
    const out = relabelChunk(segments, { speaker_A: 'speaker_0' });
    expect(out[0].speakerLabel).toBe('speaker_0');
    expect(out[1].speakerLabel).toBe('speaker_C');
  });
});

describe('LLM speaker-mapping fallback', () => {
  it('buildSpeakerMappingPrompt includes per-chunk speaker opening lines', () => {
    const prompt = buildSpeakerMappingPrompt([
      { chunkIndex: 0, speakers: { speaker_0: '大家好' } },
      { chunkIndex: 1, speakers: { speaker_A: '欢迎回来' } },
    ]);
    expect(prompt).toContain('chunk0:speaker_0');
    expect(prompt).toContain('大家好');
    expect(prompt).toContain('chunk1:speaker_A');
    expect(prompt).toContain('JSON');
  });

  it('parseSpeakerMappingResponse parses the mappings array into a SpeakerMap', () => {
    const raw = JSON.stringify({
      mappings: [
        { chunkIndex: 1, local: 'speaker_A', global: 'speaker_0' },
        { chunkIndex: 2, local: 'speaker_X', global: 'speaker_1' },
      ],
    });
    const map = parseSpeakerMappingResponse(raw);
    expect(map[1]).toEqual({ speaker_A: 'speaker_0' });
    expect(map[2]).toEqual({ speaker_X: 'speaker_1' });
  });

  it('parseSpeakerMappingResponse tolerates code fences', () => {
    const map = parseSpeakerMappingResponse('```json\n{"mappings":[{"chunkIndex":1,"local":"a","global":"b"}]}\n```');
    expect(map[1]).toEqual({ a: 'b' });
  });

  it('parseSpeakerMappingResponse returns empty map on garbage', () => {
    expect(parseSpeakerMappingResponse('nope')).toEqual({});
  });

  it('buildSpeakerMapWithLLM keeps chunk 0 as identity and merges LLM mappings', async () => {
    const fakeClient = {
      completeWithRetry: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          mappings: [
            { chunkIndex: 0, local: 'speaker_0', global: 'WRONG' }, // ignored: chunk 0 identity
            { chunkIndex: 1, local: 'speaker_A', global: 'speaker_0' },
          ],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    const chunks = [
      [{ startMs: 0, endMs: 1, text: '大家好', speakerLabel: 'speaker_0' }],
      [{ startMs: 1, endMs: 2, text: '欢迎', speakerLabel: 'speaker_A' }],
    ];
    const map = await buildSpeakerMapWithLLM(chunks, fakeClient as never);
    expect(map[0]).toEqual({}); // chunk 0 is identity (empty = pass-through)
    expect(map[1]).toEqual({ speaker_A: 'speaker_0' });
  });

  it('buildSpeakerMapWithLLM returns identity-only for a single chunk', async () => {
    const fakeClient = { completeWithRetry: vi.fn() };
    const map = await buildSpeakerMapWithLLM(
      [[{ startMs: 0, endMs: 1, text: 'x', speakerLabel: 'speaker_0' }]],
      fakeClient as never,
    );
    expect(map).toEqual({ 0: {} });
    expect(fakeClient.completeWithRetry).not.toHaveBeenCalled();
  });

  it('buildSpeakerMapWithLLM degrades gracefully when the LLM fails', async () => {
    const fakeClient = {
      completeWithRetry: vi.fn().mockRejectedValue(new Error('model down')),
    };
    const chunks = [
      [{ startMs: 0, endMs: 1, text: 'x', speakerLabel: 'speaker_0' }],
      [{ startMs: 1, endMs: 2, text: 'y', speakerLabel: 'speaker_A' }],
    ];
    const map = await buildSpeakerMapWithLLM(chunks, fakeClient as never);
    // Only chunk 0 identity; chunk 1 unmapped (keeps local label downstream).
    expect(map[0]).toEqual({});
    expect(map[1]).toBeUndefined();
  });
});
