/**
 * ParaformerProvider — Alibaba Bailian (Model Studio) recording-file recognition (A2).
 *
 * Per PRD §A2 R1: this is the default Chinese ASR + diarization path because it
 * returns native word-level timestamps AND speaker_id in a single async call,
 * with no GPU to operate. The input must be a publicly reachable URL, so the
 * pipeline uploads audio to MinIO and hands a presigned URL here.
 *
 * Flow: submit(presignedUrl, diarization_enabled=true) -> taskId
 *       poll(taskId) until status = SUCCEEDED
 *       fetch result JSON -> normalize -> TranscriptionResult
 *
 * The normalization (bailianResultToTranscription) is a pure function tested in
 * isolation from the network path.
 */

import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult, TranscriptSegment, WordTimestamp } from '@/types/domain';
import { logger } from '@/lib/logger';

// ── Bailian API types (subset we consume) ──

interface BailianWord {
  begin_time?: number; // ms within the file
  end_time?: number;
  text?: string;
  speaker_id?: string;
}

interface BailianSentence {
  begin_time?: number;
  end_time?: number;
  text?: string;
  speaker_id?: string;
  words?: BailianWord[];
}

interface BailianTranscription {
  sentences?: BailianSentence[];
}

interface BailianTaskStatus {
  StatusText?: string; // PENDING | RUNNING | SUCCEEDED | FAILED
  StatusDescription?: string;
  Results?: { Transcription?: BailianTranscription; ErrorCode?: string; ErrorMessage?: string }[];
}

const BAILIAN_ENDPOINT = process.env.BAILIAN_ENDPOINT || 'https://dashscope.aliyuncs.com/api/v1';
const BAILIAN_MODEL = process.env.BAILIAN_ASR_MODEL || 'paraformer-v2';
const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_ATTEMPTS = 120; // ~20 min ceiling for a single 2h file

export class ParaformerProvider implements TranscriptionProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BAILIAN_API_KEY || '';
  }

  getProviderName(): string {
    return 'paraformer';
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      throw new Error('ParaformerProvider requires BAILIAN_API_KEY');
    }
    // Paraformer needs a public URL; the caller resolves mediaPath -> presigned URL.
    const audioUrl =
      input.mediaPath && /^https?:\/\//.test(input.mediaPath) ? input.mediaPath : undefined;
    if (!audioUrl) {
      throw new Error('ParaformerProvider requires a public audio URL in mediaPath (presigned MinIO URL)');
    }

    const taskId = await this.submit(audioUrl, input.language);
    logger.info(`Bailian ASR submitted`, { taskId, url: audioUrl });

    const result = await this.poll(taskId);
    const transcription = result.Results?.[0]?.Transcription;
    if (!transcription?.sentences) {
      throw new Error(`Bailian ASR returned no sentences for task ${taskId}`);
    }

    const { segments, durationMs } = bailianResultToTranscription(transcription);
    logger.info(`Bailian ASR completed`, { taskId, segments: segments.length, durationMs });

    // PRD §A2 成本打点: estimate ASR cost from billed speech duration.
    const { estimateAsrCostUsd } = await import('./asr-cost');
    const costUsd = estimateAsrCostUsd(this.getProviderName(), durationMs / 1000);

    return {
      segments,
      language: input.language || 'zh',
      durationMs,
      costUsd,
      provider: this.getProviderName(),
    };
  }

  /** Submit the async recording-file recognition job. Returns the taskId. */
  private async submit(audioUrl: string, language?: string): Promise<string> {
    const body = {
      model: BAILIAN_MODEL,
      input: {
        file_urls: [audioUrl],
        parameters: {
          language_hints: language ? [language] : undefined,
          diarization_enabled: true,
          speaker_count: 0, // auto-detect
          disfluency_removal_enabled: false, // keep filler words; LLM pass cleans them
        },
      },
      parameters: { transcription_enabled: true },
    };

    const resp = await fetch(`${BAILIAN_ENDPOINT}/services/audio/asr/transcription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Bailian ASR submit failed ${resp.status}: ${errBody.slice(0, 500)}`);
    }
    const data = (await resp.json()) as { output?: { task_id?: string; task_status?: string } };
    const taskId = data.output?.task_id;
    if (!taskId) {
      throw new Error(`Bailian ASR submit returned no task_id: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return taskId;
  }

  /** Poll the task status until terminal. */
  private async poll(taskId: string): Promise<BailianTaskStatus> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const resp = await fetch(`${BAILIAN_ENDPOINT}/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!resp.ok) {
        throw new Error(`Bailian ASR poll failed ${resp.status} for task ${taskId}`);
      }
      const status = (await resp.json()) as { output?: BailianTaskStatus };
      const out = status.output;
      if (!out) {
        throw new Error(`Bailian ASR poll returned no output for task ${taskId}`);
      }
      const state = out.StatusText?.toUpperCase();
      if (state === 'SUCCEEDED') return out;
      if (state === 'FAILED') {
        throw new Error(`Bailian ASR task failed: ${out.StatusDescription ?? 'unknown'}`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Bailian ASR task ${taskId} timed out after ${POLL_MAX_ATTEMPTS} polls`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalize a Bailian transcription payload into TranscriptSegment[].
 * Pure function — unit-tested without network access.
 * Each Bailian sentence becomes one segment; words carry ms timestamps.
 * Speaker labels are propagated from sentence-level speaker_id (diarization output).
 */
export function bailianResultToTranscription(payload: BailianTranscription): {
  segments: TranscriptSegment[];
  durationMs: number;
} {
  const sentences = payload.sentences ?? [];
  const segments: TranscriptSegment[] = sentences.map((s) => {
    const words: WordTimestamp[] | undefined = s.words?.length
      ? s.words!.map((w) => ({
          word: w.text ?? '',
          startMs: w.begin_time ?? 0,
          endMs: w.end_time ?? w.begin_time ?? 0,
          confidence: undefined,
        }))
      : undefined;

    return {
      startMs: s.begin_time ?? 0,
      endMs: s.end_time ?? s.begin_time ?? 0,
      text: s.text ?? '',
      speakerLabel: s.speaker_id ? `speaker_${s.speaker_id}` : undefined,
      confidence: 0.95,
      words,
    };
  });

  const lastEnd = sentences.reduce((max, s) => Math.max(max, s.end_time ?? 0), 0);
  return { segments, durationMs: lastEnd };
}
