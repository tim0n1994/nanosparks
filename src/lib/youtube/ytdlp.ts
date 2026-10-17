/**
 * YouTube metadata fetcher — free, no API key required.
 * Uses oEmbed for metadata, yt-dlp for audio download.
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';

const JS_RUNTIME_ARGS = ['--js-runtimes', process.env.YTDLP_JS_RUNTIME ?? 'node'] as const;

function browserCookiesEnabled(): boolean {
  const preference = process.env.NSP_YTDLP_COOKIES_FROM_BROWSER;
  if (preference === 'none') return false;
  if (!preference || preference === 'chrome') return true;
  throw new Error('NSP_YTDLP_COOKIES_FROM_BROWSER must be chrome or none');
}

interface VideoMeta {
  id: string;
  title: string;
  description: string;
  duration: number;
  thumbnailUrl: string;
  channelId: string;
  channelTitle: string;
}

function execFileAsync(cmd: string, args: string[], timeoutMs = 60000): Promise<string> {
  // Use the newer yt-dlp if available (Python 3.14 version fixes YouTube SABR blocking).
  const ytDlpCmd = process.env.YTDLP_PATH || cmd;
  // A local yt-dlp config can enable browser cookies; isolated runs must ignore it.
  const commandArgs = browserCookiesEnabled() ? args : ['--ignore-config', ...args];
  return new Promise((resolve, reject) => {
    execFile(ytDlpCmd, commandArgs, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function downloadWithCookiePreference(url: string, outputPath: string): Promise<void> {
  const args = [
    ...JS_RUNTIME_ARGS,
    '-f', 'bestaudio',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', outputPath,
    url,
  ];
  if (!browserCookiesEnabled()) {
    await execFileAsync('yt-dlp', args, 600000);
    return;
  }
  try {
    await execFileAsync('yt-dlp', ['--cookies-from-browser', 'chrome', ...args], 600000);
  } catch {
    logger.warn('yt-dlp with cookies failed, trying without cookies');
    await execFileAsync('yt-dlp', args, 600000);
  }
}

export async function getVideoMeta(videoId: string): Promise<VideoMeta> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`Invalid YouTube ID: ${videoId}`);
  }

  // Try oEmbed first (free, no API key). Fall back to yt-dlp if it fails.
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const resp = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'NanoSparks/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json() as { title: string; author_name: string; author_url: string; thumbnail_url: string };
      const channelId = data.author_url?.split('@')[1]?.split('/')[0] || 'unknown';
      return {
        id: videoId,
        title: data.title || 'Untitled',
        description: data.title || '',
        duration: 0,
        thumbnailUrl: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        channelId,
        channelTitle: data.author_name || 'Unknown Channel',
      };
    }
  } catch {
    // oEmbed failed (network/timeout) — fall through to yt-dlp
  }

  // Fallback: use yt-dlp --dump-json for metadata
  try {
    const stdout = await execFileAsync('yt-dlp', ['--dump-json', '--no-warnings', ...JS_RUNTIME_ARGS, `https://www.youtube.com/watch?v=${videoId}`], 30000);
    const d = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return {
      id: videoId,
      title: String(d.title || 'Untitled'),
      description: String(d.description || ''),
      duration: Number(d.duration) || 0,
      thumbnailUrl: String(d.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
      channelId: String(d.channel_id || 'unknown'),
      channelTitle: String(d.channel || d.uploader || 'Unknown Channel'),
    };
  } catch {
    // Last resort: return minimal metadata
    return {
      id: videoId,
      title: `YouTube Video ${videoId}`,
      description: '',
      duration: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      channelId: 'unknown',
      channelTitle: 'YouTube',
    };
  }
}

export async function downloadAudio(videoId: string): Promise<string> {
  const outputDir = getAudioOutputDir();
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const outputPath = `${outputDir}/${videoId}.mp3`;

  if (existsSync(outputPath)) {
    logger.info(`Audio already downloaded`, { videoId });
    return outputPath;
  }

  logger.info(`Downloading audio via yt-dlp`, { videoId });
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  await downloadWithCookiePreference(url, outputPath);

  return outputPath;
}

/**
 * Download audio from an arbitrary yt-dlp-supported URL (Bilibili, generic sites).
 * Used by the resolver-backed ingest path for non-YouTube platforms.
 * `id` is an optional filename hint (falls back to a sanitized URL).
 * Returns the local mp3 path.
 */
export async function downloadAudioFromUrl(sourceUrl: string, id?: string): Promise<string> {
  const outputDir = getAudioOutputDir();
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const safeName = (id ?? sourceUrl).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const outputPath = `${outputDir}/${safeName}.mp3`;

  if (existsSync(outputPath)) {
    logger.info(`Audio already downloaded (url)`, { sourceUrl });
    return outputPath;
  }

  logger.info(`Downloading audio via yt-dlp (url)`, { sourceUrl });
  await downloadWithCookiePreference(sourceUrl, outputPath);

  return outputPath;
}
