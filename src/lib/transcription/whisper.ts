import { TranscriptSegment } from '@/types/analysis';
import { logger } from '@/lib/logger';
import { execFile } from 'child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'path';

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface WhisperResult {
  text: string;
  language: string;
  segments: WhisperSegment[];
}

const ALLOWED_MODEL_SIZES = ['tiny', 'base', 'small', 'medium', 'large'];

function execFileAsync(
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: options.timeout, maxBuffer: options.maxBuffer },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

async function transcribeWithDeepgram(audioPath: string): Promise<TranscriptSegment[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY not configured');
  }

  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const ext = audioPath.slice(audioPath.lastIndexOf('.')).toLowerCase();
  const extToMime: Record<string, string> = {
    '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  };
  const mimeType = extToMime[ext] || 'audio/mp4';
  const audioBuffer = readFileSync(audioPath);
  const fileSize = statSync(audioPath).size;

  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', 'nova-3-general');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('diarize', 'true');
  url.searchParams.set('utterances', 'true');

  logger.info(`Deepgram transcribing`, { path: audioPath, mimeType, fileSize });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const results = data.results as Record<string, unknown>;
  const channels = results.channels as Array<Record<string, unknown>>;
  const channel = channels?.[0];
  if (!channel) throw new Error('Deepgram returned no channels');

  const alternatives = channel.alternatives as Array<Record<string, unknown>>;
  const alt = alternatives?.[0];
  if (!alt) throw new Error('Deepgram returned no transcription');

  const metadata = data.metadata as { duration: number };
  const utterances = (results.utterances as Array<{ start: number; end: number; transcript?: string; words?: Array<{ word: string }>; speaker?: number }>) 
    ?? results.utterances as Array<Record<string, unknown>>;

  let segments: WhisperSegment[];

  if (utterances && utterances.length > 0) {
    // Use utterances with speaker labels from diarization
    segments = utterances.map((u: Record<string, unknown>) => {
      const words = u.words as Array<{ word: string }> | undefined;
      const text = words ? words.map((w) => w.word).join('') : (u.transcript as string || '');
      return {
        start: u.start as number,
        end: u.end as number,
        text,
        speaker: typeof u.speaker === 'number' ? `speaker_${u.speaker}` : undefined,
      };
    });
  } else {
    // Fallback: no utterances, use paragraphs or whole transcript
    const paragraphs = (alt.paragraphs as { paragraphs?: Array<{ start: number; end: number; sentences: Array<{ text: string }> }> })?.paragraphs;
    if (paragraphs && paragraphs.length > 0) {
      segments = paragraphs.map((p) => ({
        start: p.start,
        end: p.end,
        text: p.sentences.map((s) => s.text).join(''),
      }));
    } else {
      segments = [{ start: 0, end: metadata?.duration || 0, text: alt.transcript as string }];
    }
  }

  logger.info(`Deepgram completed`, { segments: segments.length, duration: metadata?.duration, hasSpeaker: !!segments[0]?.speaker });
  return segments;
}

async function transcribeWithLocalWhisper(audioPath: string): Promise<TranscriptSegment[]> {
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'whisper_transcribe.py');
  const rawModelSize = process.env.WHISPER_MODEL_SIZE || 'base';
  const modelSize = ALLOWED_MODEL_SIZES.includes(rawModelSize) ? rawModelSize : 'base';

  logger.info(`Starting local whisper transcription`, { audioPath, model: modelSize });

  const { stdout, stderr } = await execFileAsync(
    'python3',
    [scriptPath, audioPath, modelSize],
    { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
  );

  if (stderr && !stderr.includes('Downloading')) {
    logger.warn(`Whisper stderr`, { stderr: stderr.slice(0, 500) });
  }

  const result = JSON.parse(stdout) as WhisperResult;

  if (!result.segments || result.segments.length === 0) {
    throw new Error('No segments returned from whisper');
  }

  logger.info(`Local whisper completed`, { segments: result.segments.length, language: result.language });

  return result.segments.map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text,
    speakerId: seg.speaker,
  }));
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const errors: Error[] = [];

  // Try Deepgram first
  try {
    return await transcribeWithDeepgram(audioPath);
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  // Fallback to local Whisper
  try {
    return await transcribeWithLocalWhisper(audioPath);
  } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
  }

  throw new Error(`All transcription methods failed: ${errors.map((e) => e.message).join('; ')}`);
}

// TODO: Implement speaker diarization using pyannote.audio or whisperx
// export async function diarize(audioPath: string): Promise<SpeakerSegment[]> { ... }
