/**
 * Transcribe Job
 *
 * Supports two data formats:
 * 1. YouTube (legacy): { episodeId, youtubeUrl } — downloads audio via yt-dlp
 * 2. Upload: { sourceId, conversationId, mediaKey, mimeType } — reads from storage
 *
 * After transcription, always enqueues the analyze job.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { addAnalyzeJob } from '@/lib/queue/config';
import { downloadAudio } from '@/lib/youtube/downloader';
import { transcribeAudio } from '@/lib/transcription/whisper';
import { createStorageProvider } from '@/lib/storage/provider';
import { updateConversationStatus } from '@/lib/adapters/episode-to-conversation';
import { redactPii } from '@/lib/pii';
import { logger } from '@/lib/logger';

interface TranscribeYouTubeData {
  episodeId: string;
  youtubeUrl: string;
  /** Set by FlowProducer — skips manual analyze enqueue (parent flow handles it) */
  step?: string;
}

interface TranscribeAudioPathData {
  episodeId: string;
  audioPath: string;
  /** Set by FlowProducer — skips manual analyze enqueue */
  step?: string;
}

interface TranscribeUploadData {
  sourceId: string;
  conversationId: string;
  mediaKey: string;
  mimeType: string;
  /** Set by FlowProducer — skips manual analyze enqueue */
  step?: string;
}

type TranscribeJobData = TranscribeYouTubeData | TranscribeAudioPathData | TranscribeUploadData;

function isAudioPathData(data: TranscribeJobData): data is TranscribeAudioPathData {
  return 'audioPath' in data;
}

function isYouTubeData(data: TranscribeJobData): data is TranscribeYouTubeData {
  return 'youtubeUrl' in data;
}

export async function processTranscribeJob(data: TranscribeJobData): Promise<void> {
  if (isAudioPathData(data)) {
    return processAudioPathTranscribe(data);
  }
  if (isYouTubeData(data)) {
    return processYouTubeTranscribe(data);
  }
  return processUploadTranscribe(data);
}

/**
 * Local audio file transcription path (Xiaoyuzhou, etc.).
 * Audio already downloaded to disk by ingest job.
 */
async function processAudioPathTranscribe(data: TranscribeAudioPathData): Promise<void> {
  const { episodeId, audioPath } = data;

  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'TRANSCRIBING' },
  });

  try {
    const segments = await transcribeAudio(audioPath);

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        transcript: segments as unknown as Prisma.InputJsonValue,
        status: 'TRANSCRIBED',
      },
    });

    const redactedSegments = await Promise.all(
      segments.map(async (seg) => ({
        ...seg,
        cleanText: (await redactPii(seg.text)).redactedText,
      })),
    );

    await syncTurnsFromTranscript(episodeId, segments, redactedSegments);

    logger.info(`Audio path transcription completed for ${episodeId}`);
    // FlowProducer handles analyze as a child job — only enqueue manually for direct calls
    if (!('step' in data)) {
      await addAnalyzeJob({ episodeId });
    }
  } catch (error) {
    logger.error(`Audio path transcribe job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'FAILED' },
    });
    await updateConversationStatus(episodeId, 'failed');
    throw error;
  }
}

/**
 * YouTube transcription path (existing flow).
 */
async function processYouTubeTranscribe(data: TranscribeYouTubeData): Promise<void> {
  const { episodeId, youtubeUrl } = data;

  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'TRANSCRIBING' },
  });

  try {
    const videoIdMatch = youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch?.[1];

    let segments: { start: number; end: number; text: string; speakerId?: string }[] = [];

    if (videoId) {
      const audioPath = await downloadAudio(videoId);
      segments = await transcribeAudio(audioPath);
    } else {
      throw new Error('No video ID found in YouTube URL');
    }

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        transcript: segments as unknown as Prisma.InputJsonValue,
        status: 'TRANSCRIBED',
      },
    });

    // PII redact segments before syncing Turns
    const redactedSegments = await Promise.all(
      segments.map(async (seg) => ({
        ...seg,
        cleanText: (await redactPii(seg.text)).redactedText,
      })),
    );

    // Sync Turns from transcript segments
    await syncTurnsFromTranscript(episodeId, segments, redactedSegments);

    logger.info(`YouTube transcription completed for ${episodeId}`);
    if (!('step' in data)) {
      await addAnalyzeJob({ episodeId });
    }
  } catch (error) {
    logger.error(`YouTube transcribe job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'FAILED' },
    });
    await updateConversationStatus(episodeId, 'failed');
    throw error;
  }
}

/**
 * File upload transcription path.
 * Reads media from storage, runs local Whisper, creates Turns.
 */
async function processUploadTranscribe(data: TranscribeUploadData): Promise<void> {
  const { sourceId, conversationId, mediaKey } = data;

  logger.info(`Processing upload transcription: source=${sourceId} conversation=${conversationId}`);

  try {
    // Update source status
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: 'transcribing' },
    });

    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'transcribing' },
    });

    // Read media from storage
    const storage = createStorageProvider();
    const mediaBuffer = await storage.get(mediaKey);
    const tempPath = `/tmp/${mediaKey}`;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(tempPath, mediaBuffer);

    const whisperSegments = await transcribeAudio(tempPath);

    const segments = whisperSegments.map((seg: { start: number; end: number; text: string; speakerId?: string }) => ({
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text,
      speakerLabel: seg.speakerId,
    }));

    // Run PII redaction on segments
    const segmentsWithCleanText = await Promise.all(
      segments.map(async (seg) => ({
        ...seg,
        cleanText: (await redactPii(seg.text)).redactedText,
      })),
    );

    // Delete existing turns (idempotent sync)
    await prisma.turn.deleteMany({ where: { conversationId } });

    // Create turns from segments with PII-redacted cleanText
    await prisma.turn.createMany({
      data: segmentsWithCleanText.map((seg, idx) => ({
        conversationId,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        cleanText: seg.cleanText,
        confidence: 1.0,
        turnIndex: idx,
      })),
    });

    // Update source and conversation status
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: 'transcribed' },
    });

   await prisma.conversation.update({
     where: { id: conversationId },
     data: { status: 'transcribed' },
   });

    // PRD §A2 成本打点: record ASR cost on the conversation's latest ExtractionRun.
    // Uploads go through the whisper/deepgram legacy path; estimate from duration.
    try {
      const lastEndSec = segments.reduce((max, s) => Math.max(max, s.endMs / 1000), 0);
      const { estimateAsrCostUsd } = await import('@/lib/transcription/asr-cost');
      // Legacy transcribeAudio tries Deepgram then whisper; detect by env config.
      const provider = process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'local-whisper';
      const asrCost = estimateAsrCostUsd(provider, lastEndSec);
      // PRD §A2: probe the first 60s to set Conversation.language (drives bilingual UX).
      const { detectLanguageFromSegments } = await import('@/lib/transcription/language-probe');
      const detected = detectLanguageFromSegments(segments);
      if (detected !== 'unknown') {
        await prisma.conversation.update({ where: { id: conversationId }, data: { language: detected } });
      }
      if (asrCost > 0) {
        const run = await prisma.extractionRun.findFirst({
          where: { conversationId },
          orderBy: { startedAt: 'desc' },
          select: { id: true, costUsd: true },
        });
        if (run) {
          await prisma.extractionRun.update({
            where: { id: run.id },
            data: { costUsd: (run.costUsd ?? 0) + asrCost },
          });
        }
      }
    } catch (costErr) {
      logger.warn('ASR cost recording failed', { conversationId, error: String(costErr) });
    }

    logger.info(`Upload transcription completed for ${sourceId} (${segments.length} segments)`);

    // FlowProducer handles analyze as a child job — only enqueue manually for direct calls
    if (!('step' in data)) {
      const { analyzeQueue } = await import('@/lib/queue/config');
      await addAnalyzeJob({ conversationId, sourceId });
    }
  } catch (error) {
    logger.error(`Upload transcribe job failed for ${sourceId}`, { error: String(error) });
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: 'failed' },
    }).catch(() => {});
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'failed' },
    }).catch(() => {});
    throw error;
  }
}

async function syncTurnsFromTranscript(
  episodeId: string,
  segments: { start: number; end: number; text: string; speakerId?: string }[],
  redactedSegments?: Array<{ start: number; end: number; text: string; speakerId?: string; cleanText: string }>,
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { episodeId },
  });
  if (!conversation) return;

  await prisma.turn.deleteMany({ where: { conversationId: conversation.id } });

  await prisma.turn.createMany({
    data: segments.map((seg, idx) => ({
      conversationId: conversation.id,
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text,
      cleanText: redactedSegments?.[idx]?.cleanText ?? null,
      confidence: 1.0,
      turnIndex: idx,
    })),
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: 'transcribed' },
  });

  logger.info(`Synced ${segments.length} turns for conversation ${conversation.id}`);
}
