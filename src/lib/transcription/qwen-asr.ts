/**
 * QwenAsrProvider — Qwen3-ASR via mlx-qwen3-asr HTTP server (PRD §A2 R3 local).
 *
 * Uses the ASYNCHRONOUS API (POST /transcribe → GET /jobs/{id} poll) instead
 * of the synchronous OpenAI-compatible endpoint. The sync endpoint holds the
 * HTTP connection open for the entire transcription (which can take 30-60+ min
 * for long audio), causing undici's ~5min socket timeout ("fetch failed").
 * The async endpoint returns immediately (202 + job_id) then we poll.
 */

import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment } from '@/types/domain';
import { logger } from '@/lib/logger';
import { existsSync, statSync } from 'node:fs';

const QWEN_ASR_URL = process.env.QWEN_ASR_URL || 'http://127.0.0.1:4319';
const QWEN_ASR_KEY = process.env.QWEN_ASR_KEY || 'nsp-local';
const POLL_INTERVAL_MS = 5_000;
// 8h audio at ~real-time throughput → up to 2h of GPU time; poll generously.
const POLL_MAX_ATTEMPTS = 720; // 720 × 5s = 1h
// Single submit/poll HTTP call timeout (upload + single poll are quick).
const HTTP_TIMEOUT_MS = 5 * 60 * 1000;

interface QwenAsrSegment { start?: number; end?: number; text?: string; speaker?: string; }
interface QwenAsrResult { text?: string; language?: string; duration?: number; segments?: QwenAsrSegment[]; }

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
    // Async endpoint field is 'audio' (not 'file').
    formData.append('audio', new Blob([fileBuffer]), 'audio.m4a');
    if (language && language !== 'auto') formData.append('language', language);
    formData.append('timestamps', 'true');

    // ── Submit (async — returns immediately with job_id) ──
    const submitResp = await fetch(`${QWEN_ASR_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${QWEN_ASR_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!submitResp.ok) {
      const errBody = await submitResp.text();
      throw new Error(`QwenAsr submit failed ${submitResp.status}: ${errBody.slice(0, 500)}`);
    }
    const submitData = (await submitResp.json()) as { job_id: string; status: string };
    const jobId = submitData.job_id;
    if (!jobId) throw new Error(`QwenAsr: no job id returned: ${JSON.stringify(submitData)}`);
    logger.info('QwenAsr job submitted', { jobId });

    // ── Poll until complete ──
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      let pollResp: Response;
      try {
        pollResp = await fetch(`${QWEN_ASR_URL}/jobs/${jobId}`, {
          headers: { 'Authorization': `Bearer ${QWEN_ASR_KEY}` },
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (err) {
        // Transient network blip — retry the poll.
        logger.warn('QwenAsr poll network error, retrying', { jobId, attempt, error: String(err) });
        continue;
      }
      if (!pollResp.ok) {
        logger.warn('QwenAsr poll error', { jobId, status: pollResp.status });
        continue;
      }
      const pollData = (await pollResp.json()) as {
        status: string; result?: QwenAsrResult; error?: string;
      };
      if (pollData.status === 'completed' && pollData.result) {
        logger.info('QwenAsr completed', { jobId, attempt });
        return this.normalizeResult(pollData.result, language);
      }
      if (pollData.status === 'failed') {
        throw new Error(`QwenAsr job failed: ${pollData.error ?? 'unknown error'}`);
      }
      // Log progress every 10 polls (~50s).
      if (attempt % 10 === 9) {
        logger.info('QwenAsr still processing', { jobId, status: pollData.status, attempt });
      }
    }
    throw new Error(`QwenAsr job ${jobId} timed out after ${POLL_MAX_ATTEMPTS} polls`);
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
