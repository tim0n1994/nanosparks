/**
 * DeepgramTranscriptionProvider
 *
 * Cloud transcription via Deepgram API.
 * Uses nova-3-general model with smart_format enabled.
 * Falls back to mock on failure.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import type { TranscriptionProvider, TranscribeInput } from './provider';
import type { TranscriptionResult } from '@/types/domain';
import { estimateAsrCostUsd } from './asr-cost';
import { logger } from '@/lib/logger';

const EXT_TO_MIME: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return EXT_TO_MIME[ext] || 'audio/mp4';
}

const DEEPGRAM_BASE = 'https://api.deepgram.com/v1/listen';

interface DgWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface DgParagraph {
  sentences: Array<{ text: string; start: number; end: number }>;
  start: number;
  end: number;
  num_words: number;
}

interface DgChannel {
  alternatives: Array<{
    transcript: string;
    confidence: number;
    words: DgWord[];
    paragraphs?: { paragraphs: DgParagraph[] };
  }>;
}

interface DgResponse {
  results: {
    channels: DgChannel[];
    utterances?: Array<{ start: number; end: number; words: DgWord[]; speaker?: number }>;
  };
  metadata: {
    duration: number;
  };
}

export class DeepgramProvider implements TranscriptionProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.DEEPGRAM_API_KEY || '';
  }

  getProviderName(): string {
    return 'deepgram';
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const { mediaPath, language } = input;

    if (!mediaPath || !existsSync(mediaPath)) {
      throw new Error(`Media file not found: ${mediaPath}`);
    }

    // Detect MIME type for Content-Type header
    const mimeType = input.mimeType || getMimeType(mediaPath);

    // Build URL with query params
    const lang = language || 'zh';
    const url = new URL(DEEPGRAM_BASE);
    url.searchParams.set('model', 'nova-3-general');
    url.searchParams.set('language', lang);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('utterances', 'true');
    url.searchParams.set('paragraphs', 'true');
    // Speaker diarization — without this, utterances carry no speaker field and
    // a two-person interview collapses into a single participant.
    url.searchParams.set('diarize', 'true');

    const audioBuffer = readFileSync(mediaPath);
    const fileSize = statSync(mediaPath).size;

    logger.info(`Deepgram transcribing`, {
      path: mediaPath,
      mimeType,
      fileSize,
      language: lang,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000); // 10 min

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
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

    const data = (await response.json()) as DgResponse;
    const channel = data.results.channels[0];
    if (!channel) {
      throw new Error('Deepgram returned no channels');
    }

    const alt = channel.alternatives[0];
    if (!alt) {
      throw new Error('Deepgram returned no transcription alternatives');
    }

    const segments = this.extractSegments(data);
    const speakerLabels = this.extractSpeakerLabels(data, segments);

    logger.info(`Deepgram completed`, {
      segments: segments.length,
      duration: data.metadata.duration,
    });

    return {
      segments: segments.map((seg, i) => ({
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        text: seg.text,
        speakerLabel: speakerLabels[i],
        confidence: seg.confidence ?? 0.9,
      })),
      language: lang,
      durationMs: Math.round(data.metadata.duration * 1000),
      // PRD §A2 成本打点: estimate Deepgram cost from billed audio duration.
      costUsd: estimateAsrCostUsd(this.getProviderName(), data.metadata.duration),
      provider: this.getProviderName(),
    };
  }

  private extractSegments(data: DgResponse): Array<{ start: number; end: number; text: string; confidence?: number }> {
    const channel = data.results.channels[0];
    const alt = channel.alternatives[0];

    // Prefer paragraphs for natural sentence segmentation
    const paragraphs = alt.paragraphs?.paragraphs;
    if (paragraphs && paragraphs.length > 0) {
      return paragraphs.map((p) => {
        const text = p.sentences.map((s) => s.text).join('');
        return { start: p.start, end: p.end, text };
      });
    }

    // Fallback: use utterances from the utterance feature
    const utterances = data.results.utterances;
    if (utterances && utterances.length > 0) {
      return utterances.map((u) => {
        const text = u.words.map((w) => w.word).join(' ');
        return { start: u.start, end: u.end, text };
      });
    }

    // Final fallback: no segment info, return whole transcript as one segment
    return [{ start: 0, end: data.metadata.duration, text: alt.transcript }];
  }

  private extractSpeakerLabels(
    data: DgResponse,
    segments: Array<{ start: number; end: number; text: string; confidence?: number }>,
  ): string[] {
    const utterances = data.results.utterances;
    if (!utterances) return segments.map(() => undefined as unknown as string);

    // Map each segment to the closest utterance's speaker
    return segments.map((seg) => {
      const mid = (seg.start + seg.end) / 2;
      let best = utterances[0];
      let bestDist = Infinity;
      for (const u of utterances) {
        const uMid = (u.start + u.end) / 2;
        const dist = Math.abs(uMid - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = u;
        }
      }
      return best.speaker !== undefined
        ? `speaker_${best.speaker}`
        : undefined as unknown as string;
    });
  }

}
