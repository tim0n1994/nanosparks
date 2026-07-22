/**
 * QwenAsrProvider — Qwen3-ASR via mlx-qwen3-asr HTTP server (PRD §A2 R3 local).
 *
 * Connects to the local mlx-qwen3-asr server (running on port 4319).
 * The server exposes an OpenAI-compatible async API:
 *   POST /v1/audio/transcriptions  -> submit -> { id }
 *   GET  /v1/audio/transcriptions/{id}  -> poll -> { status, result }
 */

import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment } from '@/types/domain';
import { logger } from '@/lib/logger';
import { existsSync, statSync } from 'node:fs';

const QWEN_ASR_URL = process.env.QWEN_ASR_URL || 'http://127.0.0.1:4319';
const QWEN_ASR_KEY = process.env.QWEN_ASR_KEY || 'nsp-local';
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 200;

interface QwenAsrSegment { start?: number; end?: number; text?: string; speaker?: string; }
interface QwenAsrResult { text?: string; language?: string; duration?: number; segments?: QwenAsrSegment[]; }
interface QwenAsrJobResponse { id?: string; status?: string; error?: string; result?: QwenAsrResult; }

export class QwenAsrProvider implements TranscriptionProvider {
  getProviderName(): string { return 'qwen-asr'; }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const { mediaPath, language } = input;
    if (!mediaPath || !existsSync(mediaPath)) {
      throw new Error(`QwenAsrProvider: media file not found: ${mediaPath}`);
    }
    const fileSize = statSync(mediaPath).size;
    logger.info('QwenAsr submitting', { mediaPath, fileSize });

    const fileBuffer = await import('node:fs/promises').then((fs) => fs.readFile(mediaPath));
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), 'audio.mp3');
    if (language && language !== 'auto') formData.append('language', language);
    formData.append('response_format', 'verbose_json');
    // Enable pyannote speaker diarization — segments get speaker labels.
    formData.append('diarize', 'true');

    const submitResp = await fetch(`${QWEN_ASR_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${QWEN_ASR_KEY}` },
      body: formData,
    });
    if (!submitResp.ok) {
      const errBody = await submitResp.text();
      throw new Error(`QwenAsr submit failed ${submitResp.status}: ${errBody.slice(0, 500)}`);
    }
    const submitData = (await submitResp.json()) as QwenAsrJobResponse;

    // Synchronous response (result directly).
    if (submitData.result) return this.normalizeResult(submitData.result, language);

    const jobId = submitData.id;
    if (!jobId) throw new Error(`QwenAsr: no job id: ${JSON.stringify(submitData).slice(0, 300)}`);
    logger.info('QwenAsr job submitted', { jobId });

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const pollResp = await fetch(`${QWEN_ASR_URL}/v1/audio/transcriptions/${jobId}`, {
        headers: { 'Authorization': `Bearer ${QWEN_ASR_KEY}` },
      });
      if (!pollResp.ok) { logger.warn('QwenAsr poll error', { status: pollResp.status }); continue; }
      const pollData = (await pollResp.json()) as QwenAsrJobResponse;
      if (pollData.status === 'completed' && pollData.result) {
        logger.info('QwenAsr completed', { jobId, attempt });
        return this.normalizeResult(pollData.result, language);
      }
      if (pollData.status === 'failed') throw new Error(`QwenAsr job failed: ${pollData.error}`);
    }
    throw new Error(`QwenAsr job ${jobId} timed out`);
  }

  private normalizeResult(result: QwenAsrResult, language?: string): TranscriptionResult {
    const segments: TranscriptSegment[] = (result.segments ?? []).map((seg) => ({
      startMs: Math.round((seg.start ?? 0) * 1000),
      endMs: Math.round((seg.end ?? 0) * 1000),
      text: (seg.text ?? '').trim(),
      speakerLabel: seg.speaker ?? undefined,
      confidence: 0.9,
    }));
    if (segments.length === 0 && result.text) {
      segments.push({ startMs: 0, endMs: Math.round((result.duration ?? 0) * 1000), text: result.text.trim(), confidence: 0.9 });
    }
    return { segments, language: result.language || language || 'auto', durationMs: Math.round((result.duration ?? 0) * 1000), provider: this.getProviderName() };
  }
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
