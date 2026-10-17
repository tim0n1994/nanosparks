/**
 * Ingest Job (A1 rewrite).
 *
 * Receives a resolver-produced payload and downloads the audio, then enqueues the
 * FlowProducer processing graph (transcribe + diarize → normalize → extract).
 *
 * The new payload shape (from the resolver-backed ingest route):
 *   { conversationId, episodeKey, audioUrl, sourceUrl, platform, title, mode }
 *
 * Legacy payloads ({ episodeId, youtubeUrl }) are still supported so in-flight jobs
 * from before the resolver rollout don't crash — they route through the old path.
 */

import { prisma } from '@/lib/prisma';
import { addProcessingFlow } from '@/lib/queue/flow';
import { downloadAudioFromUrl } from '@/lib/youtube/downloader';
import { downloadAudio as ytDlpDownload, downloadAudioFromUrl as ytDlpDownloadUrl } from '@/lib/youtube/ytdlp';
import { getEpisode } from '@/lib/xiaoyuzhou/client';
import type { SourcePlatform } from '@/lib/resolvers';
import { logger } from '@/lib/logger';
import { createHash } from 'node:crypto';

/** New resolver-backed payload. */
export interface IngestResolverPayload {
  conversationId: string;
  episodeKey: string;
  audioUrl: string;
  sourceUrl: string;
  platform: SourcePlatform;
  title: string;
  mode?: string;
  asrProvider?: string;
  processingRunId?: string;
}

/** Legacy payload (pre-resolver), kept for back-compat with in-flight jobs. */
export interface IngestLegacyPayload {
  episodeId: string;
  youtubeUrl: string;
}

// Accept a loose record because BullMQ job.data is untyped at the call boundary.
export async function processIngestJob(data: IngestResolverPayload | IngestLegacyPayload | Record<string, unknown>): Promise<void> {
  if (isLegacyPayload(data)) {
    return processLegacyIngest(data);
  }
  if (isResolverPayload(data)) {
    return processResolverIngest(data);
  }
  throw new Error(`Unrecognized ingest payload: ${JSON.stringify(data).slice(0, 200)}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isLegacyPayload(data: unknown): data is IngestLegacyPayload {
  return isRecord(data) && 'episodeId' in data && 'youtubeUrl' in data && !('conversationId' in data);
}

function isResolverPayload(data: unknown): data is IngestResolverPayload {
  return isRecord(data) && 'conversationId' in data && 'audioUrl' in data;
}

/**
 * Resolver-backed ingest: the URL is already resolved to a direct audio URL.
 * Download → mark transcribing → enqueue FlowProducer keyed by conversationId.
 */
async function processResolverIngest(data: IngestResolverPayload): Promise<void> {
  const { conversationId, episodeKey, audioUrl, sourceUrl, platform, title } = data;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'processing' },
  });

  logger.info(`Ingest (resolver) downloading audio`, { conversationId, episodeKey, platform, audioUrl });

  let mediaPath: string;
  try {
    mediaPath = await downloadForPlatform(audioUrl, platform, conversationId);
    await persistDownloadedMedia({ id: conversationId }, mediaPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Ingest media preparation failed`, { conversationId, error: msg });
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'failed' } });
    throw err;
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'transcribing', title },
  });

  await addProcessingFlow({
    sourceId: conversationId,
    conversationId,
    mediaPath,
    sourceUrl,
    platform,
    episodeKey,
    asrProvider: data.asrProvider,
    processingRunId: data.processingRunId,
  });

  logger.info(`Ingest → processing flow enqueued`, { conversationId, episodeKey });
}

/** Platform-aware download: yt-dlp for video platforms, direct fetch for audio URLs. */
async function downloadForPlatform(
  audioUrl: string,
  platform: SourcePlatform,
  conversationId: string,
): Promise<string> {
  // Video sites (YouTube/Bilibili/generic) need yt-dlp extraction.
  if (platform === 'youtube' || platform === 'bilibili' || platform === 'generic') {
    // yt-dlp downloadAudio expects a video id for youtube; for others pass the URL.
    if (platform === 'youtube') {
      const id = audioUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? audioUrl;
      return ytDlpDownload(id);
    }
    // Bilibili/generic: yt-dlp handles the URL directly.
    return ytDlpDownloadUrl(audioUrl);
  }

  // Direct audio URLs (xiaoyuzhou cdn / RSS enclosure / direct link).
  return downloadAudioFromUrl(audioUrl, conversationId);
}

/** Legacy ingest path — kept so pre-resolver in-flight jobs complete safely. */
async function processLegacyIngest(data: IngestLegacyPayload): Promise<void> {
  const { episodeId, youtubeUrl } = data;
  await prisma.episode.update({ where: { id: episodeId }, data: { status: 'DOWNLOADING' } });

  try {
    // Resolve xiaoyuzhou page URLs to their audio url first.
    let audioUrl = youtubeUrl;
    if (youtubeUrl.includes('xiaoyuzhoufm.com/episode/')) {
      const eid = youtubeUrl.split('/episode/')[1]?.split('?')[0];
      if (eid) {
        const { episode } = await getEpisode(eid);
        audioUrl = episode.audioUrl;
      }
    }

    const audioPath = await downloadAudioFromUrl(audioUrl, episodeId);
    await persistDownloadedMedia({ episodeId }, audioPath);
    await prisma.episode.update({ where: { id: episodeId }, data: { status: 'TRANSCRIBING' } });
    await addProcessingFlow({ sourceId: episodeId, episodeId, mediaPath: audioPath });
    logger.info(`Legacy ingest → processing flow enqueued`, { episodeId });
  } catch (error) {
    logger.error(`Legacy ingest job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({ where: { id: episodeId }, data: { status: 'FAILED' } });
    throw error;
  }
}

async function persistDownloadedMedia(where: { id: string } | { episodeId: string }, filePath: string): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where, select: { sourceId: true } });
  if (!conversation?.sourceId) {
    logger.warn('Downloaded media has no linked source to persist its path', { ...where, filePath });
    return;
  }
  const { sourceId } = conversation;
  const id = `ingest-${createHash('sha256').update(`${sourceId}\0${filePath}`).digest('hex')}`;
  await prisma.mediaAsset.upsert({
    where: { id },
    create: { id, sourceId, mediaType: 'audio', filePath },
    update: { filePath },
  });
}
