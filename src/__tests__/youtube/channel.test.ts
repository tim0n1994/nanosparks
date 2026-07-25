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
    expect(out[0]).toMatchObject({ id: 'abc1234567_', title: 'Video One' });
    expect(out[1].id).toBe('def23456789');
  });

  it('uses the permanent standard thumbnail, ignoring yt-dlp signed URLs', () => {
    // yt-dlp emits signed thumbnail URLs (hqdefault_custom_2.jpg?sqp=...) that
    // expire → 404. We always emit the stable i.ytimg.com/vi/{id}/hqdefault.jpg.
    const out = parseFlatPlaylist(flatStdout);
    expect(out[0].thumbnailUrl).toBe('https://i.ytimg.com/vi/abc1234567_/hqdefault.jpg');
    expect(out[1].thumbnailUrl).toBe('https://i.ytimg.com/vi/def23456789/hqdefault.jpg');
    const signed = parseFlatPlaylist(JSON.stringify({
      id: 'rlY1mHhJKvs', title: 'Signed',
      thumbnails: [{ url: 'https://i.ytimg.com/vi/rlY1mHhJKvs/hqdefault_custom_2.jpg?sqp=EXPIRING&rs=SIG' }],
    }));
    expect(signed[0].thumbnailUrl).toBe('https://i.ytimg.com/vi/rlY1mHhJKvs/hqdefault.jpg');
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
