/**
 * YouTube metadata fetcher — free, no API key required.
 * Uses oEmbed for metadata, yt-dlp for audio download.
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { logger } from '@/lib/logger';

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
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

export async function getVideoMeta(videoId: string): Promise<VideoMeta> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error(`Invalid YouTube ID: ${videoId}`);
  }

  // Use oEmbed to get title + channel info (free, no API key)
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const resp = await fetch(oembedUrl, { headers: { 'User-Agent': 'NanoSparks/1.0' } });
  if (!resp.ok) {
    throw new Error(`YouTube oEmbed failed: ${resp.status}`);
  }
  const data = await resp.json() as { title: string; author_name: string; author_url: string; thumbnail_url: string };

  const channelId = data.author_url?.split('@')[1]?.split('/')[0] || 'unknown';

  return {
    id: videoId,
    title: data.title || 'Untitled',
    description: data.title || '',
    duration: 0, // oEmbed doesn't provide duration; will be updated after download
    thumbnailUrl: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    channelId,
    channelTitle: data.author_name || 'Unknown Channel',
  };
}

export async function downloadAudio(videoId: string): Promise<string> {
  const outputDir = '/tmp/nanosparks-audio';
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const outputPath = `${outputDir}/${videoId}.mp3`;

  if (existsSync(outputPath)) {
    logger.info(`Audio already downloaded`, { videoId });
    return outputPath;
  }

  logger.info(`Downloading audio via yt-dlp`, { videoId });
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Try with Chrome cookies first
    await execFileAsync('yt-dlp', [
      '--cookies-from-browser', 'chrome',
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath,
      url,
    ], 600000);
  } catch {
    // Fallback: try without cookies
    logger.warn(`yt-dlp with cookies failed, trying without cookies`);
    await execFileAsync('yt-dlp', [
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath,
      url,
    ], 600000);
  }

  return outputPath;
}
