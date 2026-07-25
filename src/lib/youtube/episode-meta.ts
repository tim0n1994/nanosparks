/**
 * Deep episode metadata fetch via yt-dlp — for the agentic episode summary.
 *
 * The flat-playlist listing only carries a title + signed thumbnail; when a user
 * expands a row to decide whether to download, we fetch the full shownotes
 * (description with chapter timestamps) + chapters array so the LLM has real
 * content to summarize into Chinese. Best-effort: returns null on any failure.
 */

import { execFile } from 'node:child_process';

export interface EpisodeMeta {
  title: string;
  description: string;
  chapters: string[];
  uploadDate: string | null;
  viewCount: number | null;
}

function execFileAsync(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  const ytDlpCmd = process.env.YTDLP_PATH || cmd;
  return new Promise((resolve, reject) => {
    execFile(ytDlpCmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

/**
 * Fetch rich metadata for a single YouTube video. `videoId` is the 11-char id.
 * Returns null on any error (yt-dlp missing, network, geo-block, etc).
 */
export async function getEpisodeMeta(videoId: string): Promise<EpisodeMeta | null> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const stdout = await execFileAsync('yt-dlp', [
      '--dump-json', '--no-warnings', '--skip-download',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], 30000);
    const d = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const chapters = Array.isArray(d.chapters)
      ? (d.chapters as Array<{ title?: string }>).map((c) => String(c.title ?? '')).filter(Boolean)
      : [];
    return {
      title: String(d.title ?? ''),
      description: String(d.description ?? ''),
      chapters,
      uploadDate: d.upload_date ? String(d.upload_date) : null,
      viewCount: typeof d.view_count === 'number' ? d.view_count : null,
    };
  } catch {
    return null;
  }
}

/** Extract an 11-char YouTube video id from a URL or return null. */
export function extractVideoId(input: string): string | null {
  const m = input.match(/(?:v=|youtu\.be\/|\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
