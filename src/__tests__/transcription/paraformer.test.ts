import { describe, it, expect } from 'vitest';
import { bailianResultToTranscription } from '@/lib/transcription/paraformer';

describe('bailianResultToTranscription', () => {
  it('normalizes a sentence into one segment with ms timestamps + speaker label', () => {
    const result = bailianResultToTranscription({
      sentences: [
        {
          begin_time: 1000,
          end_time: 3000,
          text: '大家好',
          speaker_id: '1',
          words: [
            { text: '大家', begin_time: 1000, end_time: 2000 },
            { text: '好', begin_time: 2000, end_time: 3000 },
          ],
        },
      ],
    });

    expect(result.segments).toHaveLength(1);
    const seg = result.segments[0];
    expect(seg.startMs).toBe(1000);
    expect(seg.endMs).toBe(3000);
    expect(seg.text).toBe('大家好');
    expect(seg.speakerLabel).toBe('speaker_1');
    expect(seg.words).toHaveLength(2);
    expect(seg.words![0]).toEqual({ word: '大家', startMs: 1000, endMs: 2000, confidence: undefined });
  });

  it('propagates distinct speaker ids per sentence', () => {
    const { segments } = bailianResultToTranscription({
      sentences: [
        { begin_time: 0, end_time: 1000, text: 'A', speaker_id: '0' },
        { begin_time: 1000, end_time: 2000, text: 'B', speaker_id: '1' },
        { begin_time: 2000, end_time: 3000, text: 'C', speaker_id: '0' },
      ],
    });
    expect(segments.map((s) => s.speakerLabel)).toEqual([
      'speaker_0',
      'speaker_1',
      'speaker_0',
    ]);
  });

  it('computes durationMs as the max sentence end time', () => {
    const { durationMs } = bailianResultToTranscription({
      sentences: [
        { begin_time: 0, end_time: 5000, text: 'a' },
        { begin_time: 5000, end_time: 42000, text: 'b' },
      ],
    });
    expect(durationMs).toBe(42000);
  });

  it('handles empty payload gracefully', () => {
    const { segments, durationMs } = bailianResultToTranscription({});
    expect(segments).toEqual([]);
    expect(durationMs).toBe(0);
  });

  it('omits words when the sentence has none', () => {
    const { segments } = bailianResultToTranscription({
      sentences: [{ begin_time: 0, end_time: 100, text: 'x', speaker_id: '0' }],
    });
    expect(segments[0].words).toBeUndefined();
  });

  it('treats missing speaker_id as undefined label', () => {
    const { segments } = bailianResultToTranscription({
      sentences: [{ begin_time: 0, end_time: 100, text: 'x' }],
    });
    expect(segments[0].speakerLabel).toBeUndefined();
  });
});
