/**
 * YouTube channel/playlist listing via yt-dlp — zero API key required.
 *
 * The Data API needs a key (and @handle → forHandle resolution). yt-dlp lists
 * a channel's videos or a playlist's items by scraping, with no key and no
 * quota. This is the fallback used when the Data API key is absent or fails.
 *
 * Output shape is normalized to what the resolver expects (id/title/thumbnail),
 * so the resolver can swap sources transparently.
 */

import { execFile } from 'node:child_process';
import { logger } from '@/lib/logger';

export interface ChannelVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
}

export interface ChannelMeta {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
}

function execFileAsync(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  const ytDlpCmd = process.env.YTDLP_PATH || cmd;
  return new Promise((resolve, reject) => {
    execFile(ytDlpCmd, args, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

/**
 * Pure: parse yt-dlp --flat-playlist --dump-json stdout (one JSON object per
 * line) into normalized ChannelVideo[]. Exported for unit testing without I/O.
 */
export function parseFlatPlaylist(stdout: string): ChannelVideo[] {
  const out: ChannelVideo[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const d = JSON.parse(t) as Record<string, unknown>;
      const id = extractVideoId(d);
      if (!id) continue;
      out.push({
        id,
        title: String(d.title ?? '(untitled)'),
        thumbnailUrl: pickThumb(d.thumbnails) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        durationSec: typeof d.duration === 'number' ? d.duration : 0,
      });
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Extract the 11-char video id from a flat-playlist entry. */
function extractVideoId(d: Record<string, unknown>): string | null {
  const raw = (d.id ?? d.url ?? '') as string;
  const m = String(raw).match(/([a-zA-Z0-9_-]{11})$/);
  return m ? m[1] : null;
}

function pickThumb(thumbs: unknown): string | null {
  if (!Array.isArray(thumbs)) return null;
  const arr = thumbs as Array<{ url?: string }>;
  return arr[arr.length - 1]?.url ?? arr[0]?.url ?? null;
}

/**
 * List a channel's recent videos via yt-dlp (no API key). `channel` may be a
 * @handle, vanity name, or UC id. Returns up to `maxResults` newest videos.
 */
export async function listChannelVideos(channel: string, maxResults = 10): Promise<ChannelVideo[]> {
  const url = channelUrl(channel, 'videos');
  const stdout = await execFileAsync('yt-dlp', [
    '--flat-playlist', '--dump-json', '--no-warnings',
    '--playlist-end', String(maxResults),
    url,
  ], 90000);
  return parseFlatPlaylist(stdout);
}

/** Fetch a channel's metadata (title/description/id/avatar) via yt-dlp. */
export async function getChannelMeta(channel: string): Promise<ChannelMeta> {
  // --playlist-items 1 fetches one video but carries full channel context.
  const stdout = await execFileAsync('yt-dlp', [
    '--dump-json', '--no-warnings', '--playlist-items', '1',
    channelUrl(channel, 'videos'),
  ], 60000);
  const line = stdout.split('\n').find((l) => l.trim()) ?? '{}';
  const d = JSON.parse(line) as Record<string, unknown>;
  return {
    id: String(d.channel_id ?? channel),
    title: String(d.channel ?? d.uploader ?? channel),
    description: String(d.description ?? '').slice(0, 2000),
    thumbnailUrl: String(d.thumbnails && Array.isArray(d.thumbnails) ? (d.thumbnails as Array<{ url?: string }>)[0]?.url : '') || '',
  };
}

/** Fetch a playlist's title + videos via yt-dlp (no API key). */
export async function getPlaylistMeta(playlistId: string, maxResults = 20): Promise<{ title: string; videos: ChannelVideo[] }> {
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;
  const stdout = await execFileAsync('yt-dlp', [
    '--flat-playlist', '--dump-json', '--no-warnings',
    '--playlist-end', String(maxResults),
    url,
  ], 90000);
  const videos = parseFlatPlaylist(stdout);
  // Playlist title isn't in flat-playlist entries; fetch it cheaply.
  let title = `YouTube Playlist ${playlistId}`;
  try {
    const meta = await execFileAsync('yt-dlp', ['--dump-json', '--no-warnings', '--playlist-items', '1', url], 60000);
    const line = meta.split('\n').find((l) => l.trim()) ?? '{}';
    title = String((JSON.parse(line) as Record<string, unknown>).playlist_title ?? title);
  } catch {
    /* keep fallback title */
  }
  return { title, videos };
}

/** Build a canonical channel URL from any identifier shape. */
function channelUrl(channel: string, tab: 'videos'): string {
  const c = channel.startsWith('@') ? channel : channel.startsWith('UC') ? `channel/${channel}` : `@${channel}`;
  return `https://www.youtube.com/${c}/${tab}`;
}

/** Whether yt-dlp is available as a fallback (PATH or YTDLP_PATH). */
export async function isYtDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', ['--version'], 5000);
    return true;
  } catch {
    logger.warn('yt-dlp not available for channel fallback');
    return false;
  }
}
