/**
 * Transcribe Job
 *
 * Supports two data formats:
 * 1. YouTube (legacy): { episodeId, youtubeUrl } — downloads audio via yt-dlp
 * 2. Upload: { sourceId, conversationId, mediaKey, mimeType } — reads from storage
 *
 * Direct jobs enqueue analysis; FlowProducer jobs release their parent instead.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { addAnalyzeJob } from '@/lib/queue/config';
import { downloadAudio } from '@/lib/youtube/downloader';
import { transcribeAudio } from '@/lib/transcription/whisper';
import { createTranscriptionProvider, isChineseSource } from '@/lib/transcription/factory';
import { stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorageProvider } from '@/lib/storage/provider';
import { updateConversationStatus } from '@/lib/adapters/episode-to-conversation';
import { redactPii } from '@/lib/pii';
import { cleanCjkSpaces } from '@/lib/transcription/cjk-space-cleanup';
import { logger } from '@/lib/logger';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';

const TRANSCRIPT_TRANSACTION_OPTIONS = { timeout: 60_000 };
const TURN_WRITE_BATCH_SIZE = 1000;

export interface TranscribeJobData {
  episodeId?: string;
  conversationId?: string;
  sourceId?: string;
  audioPath?: string;
  mediaPath?: string;
  mediaKey?: string;
  youtubeUrl?: string;
  mimeType?: string;
  asrProvider?: string;
  /** Set by FlowProducer — skips manual analyze enqueue */
  step?: string;
}

export async function processTranscribeJob(data: TranscribeJobData): Promise<void> {
  if (data.conversationId && !data.episodeId) {
    return processConversationTranscribe({ ...data, conversationId: data.conversationId });
  }
  if (data.episodeId) {
    const conversation = await prisma.conversation.findFirst({ where: { episodeId: data.episodeId }, select: { id: true } });
    let media: Awaited<ReturnType<typeof resolveAudioInput>> | undefined;
    try {
      media = await resolveAudioInput({ ...data, conversationId: conversation?.id });
      return await processAudioPathTranscribe({ ...data, episodeId: data.episodeId, audioPath: media.path });
    } catch (error) {
      await prisma.episode.update({ where: { id: data.episodeId }, data: { status: 'FAILED' } }).catch(() => {});
      await updateConversationStatus(data.episodeId, 'failed').catch(() => {});
      throw error;
    } finally {
      await media?.cleanup();
    }
  }
  throw new Error('Transcription requires a conversationId or episodeId');
}

/**
 * Conversation-based transcription path (new resolver pipeline).
 * Uses Qwen3-ASR (or whatever the factory picks) to transcribe the audio
 * and writes turns directly to the Conversation.
 */
async function processConversationTranscribe(data: TranscribeJobData & { conversationId: string }): Promise<void> {
  const { conversationId } = data;
  // Language hint from episode title (isChineseSource heuristic) — without it
  // providers fall back to their own default (Deepgram hardcodes zh), which
  // decodes English audio as garbage.
  const meta = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { title: true, sourceId: true, globalEpisode: { select: { title: true, platform: true } } },
  });
  const title = meta?.globalEpisode?.title ?? meta?.title ?? '';
  const language = isChineseSource({ title, platform: meta?.globalEpisode?.platform ?? undefined }) ? 'zh' : 'en';

  let media: Awaited<ReturnType<typeof resolveAudioInput>> | undefined;
  try {
    media = await resolveAudioInput(data);
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'transcribing' } });
    if (meta?.sourceId) await prisma.source.update({ where: { id: meta.sourceId }, data: { status: 'transcribing' } });
    logger.info('Conversation transcription starting', { conversationId, audioPath: media.path, language });
    const provider = createTranscriptionProvider({ override: data.asrProvider });
    const result = await provider.transcribe({ mediaPath: media.path, mimeType: data.mimeType, language });
    const usableSegments = result.segments.filter((segment) => segment.text.trim().length > 0);
    if (!usableSegments.length) throw new Error('Transcription returned no segments with text');
    const segments = await Promise.all(usableSegments.map(async (seg) => ({
      ...seg,
      text: cleanCjkSpaces(seg.text),
      cleanText: (await redactPii(cleanCjkSpaces(seg.text))).redactedText,
    })));

    // ASR and redaction must succeed before replacing any existing transcript.
    await prisma.$transaction(async (tx) => {
      await tx.turn.deleteMany({ where: { conversationId } });
      await tx.participant.deleteMany({ where: { conversationId } });
      const speakerToParticipant = new Map<string, string>();
      for (const seg of segments) {
        const label = seg.speakerLabel || 'SPEAKER_UNKNOWN';
        if (!speakerToParticipant.has(label)) {
          const participant = await tx.participant.create({
            data: { conversationId, name: label, speakerLabel: label, confidence: seg.confidence ?? 1.0 },
          });
          speakerToParticipant.set(label, participant.id);
        }
      }
      await createTurnBatches(tx, segments.map((seg, idx) => ({
        conversationId, startMs: seg.startMs, endMs: seg.endMs, text: seg.text,
        cleanText: seg.cleanText,
        participantId: speakerToParticipant.get(seg.speakerLabel || 'SPEAKER_UNKNOWN') ?? null,
        confidence: seg.confidence ?? 1.0, turnIndex: idx,
      })));
      await tx.conversation.update({ where: { id: conversationId }, data: { status: 'transcribed', language: result.language } });
      if (meta?.sourceId) await tx.source.update({ where: { id: meta.sourceId }, data: { status: 'transcribed' } });
    }, TRANSCRIPT_TRANSACTION_OPTIONS);
    logger.info('Conversation transcription completed', { conversationId, turns: segments.length, provider: result.provider });
    if (!data.step) await addAnalyzeJob({ conversationId, ...(meta?.sourceId ? { sourceId: meta.sourceId } : {}) });
  } catch (error) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'failed' } }).catch(() => {});
    if (meta?.sourceId) await prisma.source.update({ where: { id: meta.sourceId }, data: { status: 'failed' } }).catch(() => {});
    throw error;
  } finally {
    await media?.cleanup();
  }
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isFile()).catch(() => false);
}

async function resolveAudioInput(data: TranscribeJobData): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const local = (path: string) => ({ path, cleanup: async () => {} });
  const fromStorage = async (key: string) => {
    const buffer = await createStorageProvider().get(key);
    const directory = await mkdtemp(join(tmpdir(), 'nanosparks-transcribe-'));
    const path = join(directory, `media${extname(key) || '.audio'}`);
    const cleanup = () => rm(directory, { recursive: true, force: true }).catch((error: unknown) => {
      logger.warn('Transcription temporary file cleanup failed', { directory, error: String(error) });
    });
    try {
      await writeFile(path, buffer);
      return { path, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  };
  for (const path of [data.audioPath, data.mediaPath]) {
    if (path && await isFile(path)) return local(path);
  }
  if (data.mediaKey) return fromStorage(data.mediaKey);
  const conversation = data.conversationId ? await prisma.conversation.findUnique({
    where: { id: data.conversationId },
    select: {
      episodeKey: true, globalEpisode: { select: { platformId: true } },
      source: { select: { mediaAssets: { where: { mediaType: { in: ['audio', 'video'] } }, orderBy: { createdAt: 'desc' }, select: { storageKey: true, filePath: true } } } },
    },
  }) : null;
  const assets = conversation?.source?.mediaAssets ?? [];
  for (const asset of assets) {
    if (asset.filePath && await isFile(asset.filePath)) return local(asset.filePath);
  }
  for (const asset of assets) {
    if (asset.storageKey) return fromStorage(asset.storageKey);
  }
  // Old ingest jobs did not persist MediaAssets; retain their known filename conventions.
  const audioDirectory = getAudioOutputDir();
  const platformId = conversation?.globalEpisode?.platformId || conversation?.episodeKey?.split(':')[1];
  for (const id of [data.conversationId, data.episodeId, platformId]) {
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) {
      const path = join(audioDirectory, `${id}.mp3`);
      if (await isFile(path)) return local(path);
    }
  }
  if (data.youtubeUrl) {
    const videoId = data.youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) throw new Error('No video ID found in YouTube URL');
    return local(await downloadAudio(videoId));
  }
  throw new Error(`No audio file found for ${data.conversationId ? `conversation ${data.conversationId}` : `episode ${data.episodeId}`}`);
}

async function processAudioPathTranscribe(data: TranscribeJobData & { episodeId: string; audioPath: string }): Promise<void> {
  const { episodeId, audioPath } = data;

  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'TRANSCRIBING' },
  });

  try {
    const segments = (await transcribeAudio(audioPath)).filter((segment) => segment.text.trim().length > 0);
    if (!segments.length) throw new Error('Transcription returned no segments with text');

    const redactedSegments = await Promise.all(
      segments.map(async (seg) => ({
        ...seg,
        cleanText: (await redactPii(seg.text)).redactedText,
      })),
    );

    await syncTurnsFromTranscript(episodeId, segments, redactedSegments);

    logger.info(`Audio path transcription completed for ${episodeId}`);
    if (!data.step) {
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

async function syncTurnsFromTranscript(
  episodeId: string,
  segments: { start: number; end: number; text: string; speakerId?: string }[],
  redactedSegments?: Array<{ start: number; end: number; text: string; speakerId?: string; cleanText: string }>,
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { episodeId },
  });
  const turns = conversation ? segments.map((seg, idx) => ({
    conversationId: conversation.id,
    startMs: Math.round(seg.start * 1000),
    endMs: Math.round(seg.end * 1000),
    text: cleanCjkSpaces(seg.text),
    cleanText: redactedSegments?.[idx]?.cleanText ?? null,
    confidence: 1.0,
    turnIndex: idx,
  })) : [];
  await prisma.$transaction(async (tx) => {
    await tx.episode.update({
      where: { id: episodeId },
      data: { transcript: segments as unknown as Prisma.InputJsonValue, status: 'TRANSCRIBED' },
    });
    if (!conversation) return;
    await tx.turn.deleteMany({ where: { conversationId: conversation.id } });
    await tx.participant.deleteMany({ where: { conversationId: conversation.id } });
    await createTurnBatches(tx, turns);
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { status: 'transcribed' },
    });
  }, TRANSCRIPT_TRANSACTION_OPTIONS);
  if (conversation) logger.info(`Synced ${segments.length} turns for conversation ${conversation.id}`);
}

async function createTurnBatches(tx: Prisma.TransactionClient, turns: Prisma.TurnCreateManyInput[]): Promise<void> {
  for (let offset = 0; offset < turns.length; offset += TURN_WRITE_BATCH_SIZE) {
    await tx.turn.createMany({ data: turns.slice(offset, offset + TURN_WRITE_BATCH_SIZE) });
  }
}
