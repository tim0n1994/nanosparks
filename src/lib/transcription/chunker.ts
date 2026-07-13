import { TranscriptSegment } from '@/types/analysis';

const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP = 200;

export function chunkTranscript(
  segments: TranscriptSegment[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): TranscriptSegment[][] {
  if (segments.length === 0) return [];

  const chunks: TranscriptSegment[][] = [];
  let currentChunk: TranscriptSegment[] = [];
  let currentLength = 0;

  for (const segment of segments) {
    const textLength = segment.text.length;

    if (currentLength + textLength > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);

      const overlapSegments = getOverlapSegments(currentChunk, overlap);
      currentChunk = [...overlapSegments, segment];
      currentLength = overlapSegments.reduce((sum, s) => sum + s.text.length, 0) + textLength;
    } else {
      currentChunk.push(segment);
      currentLength += textLength;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function getOverlapSegments(segments: TranscriptSegment[], overlap: number): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  let length = 0;

  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (length + segment.text.length > overlap && result.length > 0) break;
    result.unshift(segment);
    length += segment.text.length;
  }

  return result;
}

export function mergeChunks(chunks: TranscriptSegment[][]): TranscriptSegment[] {
  const seen = new Set<string>();
  const merged: TranscriptSegment[] = [];

  for (const chunk of chunks) {
    for (const segment of chunk) {
      const key = `${segment.start}-${segment.end}-${segment.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(segment);
      }
    }
  }

  return merged.sort((a, b) => a.start - b.start);
}
