/**
 * Shared yt-dlp metadata helper (A1).
 *
 * yt-dlp natively supports 1000+ sites (Bilibili, generic, etc.). We run it with
 * --dump-json to get title/uploader/duration/thumbnail/url without downloading audio.
 * The actual audio download still happens downstream in the ingest job.
 */

import { execFile } from 'node:child_process';
import { logger } from '@/lib/logger';

export interface YtDlpMeta {
  id: string;
  title: string;
  description?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
  extractor_key?: string;
}

function execFileAsync(cmd: string, args: string[], timeoutMs = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Classify yt-dlp failure text into a resolver error kind. */
export function classifyYtDlpError(stderr: string): 'login_required' | 'region_restricted' | 'no_audio' | 'unknown' {
  const low = stderr.toLowerCase();
  if (low.includes('login') || low.includes('sign in') || low.includes('cookies') || low.includes('authentication')) {
    return 'login_required';
  }
  if (low.includes('geo') || low.includes('region') || low.includes('not available in your country')) {
    return 'region_restricted';
  }
  if (low.includes('no video') || low.includes('no audio') || low.includes('unsupported')) {
    return 'no_audio';
  }
  return 'unknown';
}

/** Fetch yt-dlp JSON metadata for an arbitrary supported URL. */
export async function getYtDlpMeta(
  url: string,
  opts: { cookies?: string } = {},
): Promise<YtDlpMeta> {
  const args = ['--dump-json', '--no-playlist', '--no-warnings', url];
  if (opts.cookies) {
    args.unshift('--cookies', opts.cookies);
  }
  logger.info(`yt-dlp metadata fetch`, { url });
  const out = await execFileAsync('yt-dlp', args);
  return JSON.parse(out.trim()) as YtDlpMeta;
}
