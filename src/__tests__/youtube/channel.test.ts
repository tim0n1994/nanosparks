import { describe, it, expect } from 'vitest';
import { parseFlatPlaylist } from '@/lib/youtube/channel';

// Two yt-dlp --flat-playlist --dump-json lines (one JSON per line).
const flatStdout = [
  JSON.stringify({ id: 'abc1234567_', title: 'Video One', thumbnails: [{ url: 'http://t1.jpg' }] }),
  JSON.stringify({ id: 'https://www.youtube.com/watch?v=def23456789', title: 'Video Two', thumbnails: [{ url: 'http://t2a.jpg' }, { url: 'http://t2b.jpg' }] }),
  '', // trailing newline
  '{not json}', // malformed line — must be skipped, not throw
].join('\n');

describe('parseFlatPlaylist (yt-dlp channel fallback)', () => {
  it('extracts id/title/thumbnail per valid line', () => {
    const out = parseFlatPlaylist(flatStdout);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'abc1234567_', title: 'Video One', thumbnailUrl: 'http://t1.jpg' });
    expect(out[1].id).toBe('def23456789');
  });

  it('picks the last (highest-res) thumbnail when several are present', () => {
    const out = parseFlatPlaylist(flatStdout);
    expect(out[1].thumbnailUrl).toBe('http://t2b.jpg');
  });

  it('falls back to a derived thumbnail when none provided', () => {
    const out = parseFlatPlaylist(JSON.stringify({ id: 'xyz99999999', title: 'No Thumb' }));
    expect(out[0].thumbnailUrl).toBe('https://i.ytimg.com/vi/xyz99999999/hqdefault.jpg');
  });

  it('ignores entries with no 11-char video id', () => {
    const out = parseFlatPlaylist(JSON.stringify({ id: 'short', title: 'Bad' }));
    expect(out).toHaveLength(0);
  });

  it('returns [] for empty input', () => {
    expect(parseFlatPlaylist('')).toEqual([]);
  });
});
