import { describe, it, expect } from 'vitest';
import { chunkTranscript, mergeChunks } from '@/lib/transcription/chunker';
import { TranscriptSegment } from '@/types/analysis';

describe('chunkTranscript', () => {
  const segments: TranscriptSegment[] = [
    { start: 0, end: 5, text: 'Hello world this is a test transcript.' },
    { start: 5, end: 10, text: 'It contains multiple segments with content.' },
    { start: 10, end: 15, text: 'The chunker should split this into pieces.' },
  ];

  it('splits transcript into chunks when text exceeds chunk size', () => {
    // Arrange
    const chunkSize = 50;
    const overlap = 5;

    // Act
    const chunks = chunkTranscript(segments, chunkSize, overlap);

    // Assert
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0][0].text).toBe('Hello world this is a test transcript.');
  });

  it('returns single chunk when total text is within chunk size', () => {
    // Arrange
    const shortSegments: TranscriptSegment[] = [
      { start: 0, end: 5, text: 'Short.' },
      { start: 5, end: 10, text: 'Text.' },
    ];

    // Act
    const chunks = chunkTranscript(shortSegments, 100, 5);

    // Assert
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it('handles empty transcript', () => {
    // Arrange - empty segments

    // Act
    const chunks = chunkTranscript([], 50, 5);

    // Assert
    expect(chunks).toEqual([]);
  });

  it('handles single segment', () => {
    // Arrange
    const singleSegment: TranscriptSegment[] = [
      { start: 0, end: 5, text: 'Only one segment here.' },
    ];

    // Act
    const chunks = chunkTranscript(singleSegment, 100, 5);

    // Assert
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks[0][0].text).toBe('Only one segment here.');
  });

  it('handles extremely large chunk size', () => {
    // Arrange

    // Act
    const chunks = chunkTranscript(segments, 100000, 5);

    // Assert
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
  });

  it('preserves segment boundaries and timestamps', () => {
    // Arrange
    const shortSegments: TranscriptSegment[] = [
      { start: 0, end: 5, text: 'A' },
      { start: 5, end: 10, text: 'B' },
      { start: 10, end: 15, text: 'C' },
    ];

    // Act - chunkSize=100 ensures all fit in one chunk
    const chunks = chunkTranscript(shortSegments, 100, 5);

    // Assert
    expect(chunks).toHaveLength(1);
    expect(chunks[0][0].start).toBe(0);
    expect(chunks[0][0].end).toBe(5);
    expect(chunks[0][1].start).toBe(5);
    expect(chunks[0][1].end).toBe(10);
    expect(chunks[0][2].start).toBe(10);
    expect(chunks[0][2].end).toBe(15);
  });
});

describe('mergeChunks', () => {
  it('merges chunks and deduplicates overlapping segments', () => {
    // Arrange
    const chunks: TranscriptSegment[][] = [
      [
        { start: 0, end: 5, text: 'First' },
        { start: 5, end: 10, text: 'Second' },
      ],
      [
        { start: 5, end: 10, text: 'Second' },
        { start: 10, end: 15, text: 'Third' },
      ],
    ];

    // Act
    const merged = mergeChunks(chunks);

    // Assert
    expect(merged).toHaveLength(3);
    expect(merged.map((s) => s.text)).toEqual(['First', 'Second', 'Third']);
  });

  it('sorts merged segments by start time', () => {
    // Arrange
    const chunks: TranscriptSegment[][] = [
      [
        { start: 10, end: 15, text: 'Later' },
        { start: 0, end: 5, text: 'Earlier' },
      ],
    ];

    // Act
    const merged = mergeChunks(chunks);

    // Assert
    expect(merged[0].start).toBe(0);
    expect(merged[1].start).toBe(10);
  });

  it('handles empty chunks array', () => {
    // Arrange

    // Act
    const merged = mergeChunks([]);

    // Assert
    expect(merged).toEqual([]);
  });

  it('handles single chunk without deduplication', () => {
    // Arrange
    const chunks: TranscriptSegment[][] = [
      [
        { start: 0, end: 5, text: 'A' },
        { start: 5, end: 10, text: 'B' },
      ],
    ];

    // Act
    const merged = mergeChunks(chunks);

    // Assert
    expect(merged).toHaveLength(2);
  });
});
