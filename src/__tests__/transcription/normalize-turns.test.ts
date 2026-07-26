import { describe, it, expect } from 'vitest';
import { normalizeTurns } from '@/lib/transcription/normalize-turns';
import { assignSpeaker } from '@/lib/transcription/normalize-turns';
import type { TranscriptSegment, SpeakerSegment } from '@/types/domain';

describe('assignSpeaker (L1 attribution primitive)', () => {
  // The normalize_turns job attributes each Turn via assignSpeaker(turn.startMs,
  // turn.endMs, segments). Lock the overlap contract used by the P-1 fix.
  const segs: SpeakerSegment[] = [
    { label: 'SPEAKER_00', startMs: 0, endMs: 2900 },
    { label: 'SPEAKER_01', startMs: 2900, endMs: 6000 },
  ];

  it('picks the segment with the most overlap', () => {
    // Turn entirely inside speaker 0.
    expect(assignSpeaker(100, 500, segs)).toBe('SPEAKER_00');
    // Turn entirely inside speaker 1.
    expect(assignSpeaker(3500, 4000, segs)).toBe('SPEAKER_01');
  });

  it('falls back to the midpoint segment when no overlap', () => {
    // Gap between segments (2900..2900) — midpoint 2900 sits on the boundary of
    // speaker 1's [2900,6000].
    const label = assignSpeaker(2890, 2910, segs);
    expect(['SPEAKER_00', 'SPEAKER_01']).toContain(label);
  });

  it('returns undefined for an empty timeline', () => {
    expect(assignSpeaker(0, 1000, [])).toBeUndefined();
  });
});

describe('normalizeTurns', () => {
  const asrSegments: TranscriptSegment[] = [
    {
      startMs: 0,
      endMs: 3000,
      text: 'Hello everyone welcome to the show',
      words: [
        { word: 'Hello', startMs: 0, endMs: 500 },
        { word: 'everyone', startMs: 500, endMs: 1000 },
        { word: 'welcome', startMs: 1000, endMs: 1500 },
        { word: 'to', startMs: 1500, endMs: 2000 },
        { word: 'the', startMs: 2000, endMs: 2500 },
        { word: 'show', startMs: 2500, endMs: 3000 },
      ],
    },
    {
      startMs: 3000,
      endMs: 6000,
      text: 'Thanks for having me',
      words: [
        { word: 'Thanks', startMs: 3000, endMs: 3500 },
        { word: 'for', startMs: 3500, endMs: 4000 },
        { word: 'having', startMs: 4000, endMs: 5000 },
        { word: 'me', startMs: 5000, endMs: 6000 },
      ],
    },
  ];

  const diarizationSegments: SpeakerSegment[] = [
    { label: 'SPEAKER_00', startMs: 0, endMs: 2800 },
    { label: 'SPEAKER_01', startMs: 2900, endMs: 6000 },
  ];

  it('assigns words to speakers based on diarization overlap', () => {
    const turns = normalizeTurns(
      asrSegments,
      { segments: diarizationSegments, speakerCount: 2 },
    );

    expect(turns.length).toBe(2);
    expect(turns[0].speakerLabel).toBe('SPEAKER_00');
    expect(turns[0].text).toContain('Hello');
    expect(turns[1].speakerLabel).toBe('SPEAKER_01');
    expect(turns[1].text).toContain('Thanks');
  });

  it('groups consecutive same-speaker words into a single turn', () => {
    const segments: TranscriptSegment[] = [
      {
        startMs: 0,
        endMs: 2000,
        text: 'word1 word2',
        words: [
          { word: 'word1', startMs: 0, endMs: 1000 },
          { word: 'word2', startMs: 1000, endMs: 2000 },
        ],
      },
    ];
    const diarization = {
      segments: [{ label: 'SPEAKER_00', startMs: 0, endMs: 2000 }],
      speakerCount: 1,
    };

    const turns = normalizeTurns(segments, diarization);

    expect(turns).toHaveLength(1);
    expect(turns[0].speakerLabel).toBe('SPEAKER_00');
    expect(turns[0].text).toBe('word1 word2');
    expect(turns[0].words).toHaveLength(2);
  });

  it('splits turns when speaker changes', () => {
    const segments: TranscriptSegment[] = [
      {
        startMs: 0,
        endMs: 4000,
        text: 'speaker A talks speaker B talks',
        words: [
          { word: 'speaker', startMs: 0, endMs: 500 },
          { word: 'A', startMs: 500, endMs: 1000 },
          { word: 'talks', startMs: 1000, endMs: 1500 },
          { word: 'speaker', startMs: 2000, endMs: 2500 },
          { word: 'B', startMs: 2500, endMs: 3000 },
          { word: 'talks', startMs: 3000, endMs: 3500 },
        ],
      },
    ];
    const diarization = {
      segments: [
        { label: 'SPEAKER_00', startMs: 0, endMs: 1500 },
        { label: 'SPEAKER_01', startMs: 2000, endMs: 3500 },
      ],
      speakerCount: 2,
    };

    const turns = normalizeTurns(segments, diarization);

    expect(turns).toHaveLength(2);
    expect(turns[0].speakerLabel).toBe('SPEAKER_00');
    expect(turns[1].speakerLabel).toBe('SPEAKER_01');
  });

  it('falls back to SPEAKER_00 when no diarization available', () => {
    const turns = normalizeTurns(asrSegments, { segments: [], speakerCount: 0 });

    expect(turns.length).toBe(2);
    expect(turns.every((t) => t.speakerLabel === 'SPEAKER_00')).toBe(true);
  });

  it('handles empty ASR segments', () => {
    const turns = normalizeTurns([], { segments: diarizationSegments, speakerCount: 2 });
    expect(turns).toEqual([]);
  });

  it('splits long turns at maxTurnDurationMs', () => {
    const segments: TranscriptSegment[] = [
      {
        startMs: 0,
        endMs: 90000,
        text: 'word1 word2 word3',
        words: [
          { word: 'word1', startMs: 0, endMs: 30000 },
          { word: 'word2', startMs: 30000, endMs: 60000 },
          { word: 'word3', startMs: 60000, endMs: 90000 },
        ],
      },
    ];
    const diarization = {
      segments: [{ label: 'SPEAKER_00', startMs: 0, endMs: 90000 }],
      speakerCount: 1,
    };

    const turns = normalizeTurns(segments, diarization, { maxTurnDurationMs: 60000 });

    expect(turns.length).toBeGreaterThan(1);
  });

  it('produces pseudo-words when word timestamps are not available', () => {
    const segments: TranscriptSegment[] = [
      { startMs: 0, endMs: 3000, text: 'hello world' },
    ];
    const diarization = {
      segments: [{ label: 'SPEAKER_00', startMs: 0, endMs: 3000 }],
      speakerCount: 1,
    };

    const turns = normalizeTurns(segments, diarization);

    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('hello world');
    expect(turns[0].words).toBeDefined();
    expect(turns[0].words!.length).toBe(2);
  });
});
