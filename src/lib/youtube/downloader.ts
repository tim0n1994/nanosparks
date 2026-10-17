import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';

const execFileAsync = promisify(execFile);

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isValidYoutubeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

async function downloadWithYtDlp(youtubeId: string, outputPath: string): Promise<void> {
  const { stderr } = await execFileAsync(
    'yt-dlp',
    [
      ...(process.env.NSP_YTDLP_COOKIES_FROM_BROWSER === 'none' ? ['--ignore-config'] : []),
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ],
    { timeout: 600000 }
  );
  if (stderr && stderr.includes('ERROR')) {
    throw new Error(`yt-dlp error: ${stderr}`);
  }
}

export async function downloadAudio(youtubeId: string): Promise<string> {
  if (!isValidYoutubeId(youtubeId)) {
    throw new Error(`Invalid YouTube ID: ${youtubeId}`);
  }

  const outputDir = getAudioOutputDir();
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${youtubeId}.mp3`);

  if (fs.existsSync(outputPath)) {
    logger.info(`Audio already downloaded`, { youtubeId, path: outputPath });
    return outputPath;
  }

  const hasYtDlp = await checkCommand('yt-dlp');
  if (hasYtDlp) {
    try {
      logger.info(`Downloading audio with yt-dlp`, { youtubeId });
      await downloadWithYtDlp(youtubeId, outputPath);
      logger.info(`Download complete`, { youtubeId, path: outputPath });
      return outputPath;
    } catch (error) {
      logger.error(`yt-dlp download failed`, { youtubeId, error: String(error) });
    }
  }

  throw new Error(`No youtube downloader available for ${youtubeId}`);
}

/**
 * Download audio from a direct URL (e.g. Xiaoyuzhou m4a).
 * Returns the local file path.
 */
export async function downloadAudioFromUrl(
  audioUrl: string,
  filename: string,
): Promise<string> {
  const outputDir = getAudioOutputDir();
  ensureDir(outputDir);
  const ext = path.extname(new URL(audioUrl).pathname) || '.m4a';
  const outputPath = path.join(outputDir, `${filename}${ext}`);

  if (fs.existsSync(outputPath)) {
    logger.info(`Audio already downloaded`, { filename, path: outputPath });
    return outputPath;
  }

  logger.info(`Downloading audio from URL`, { audioUrl, path: outputPath });

  const response = await fetch(audioUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  logger.info(`Download complete`, { filename, size: buffer.length, path: outputPath });
  return outputPath;
}
