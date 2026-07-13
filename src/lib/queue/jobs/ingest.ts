/**
 * Ingest Job
 *
 * Downloads audio (the "acquire" step), then enqueues the processing
 * flow via FlowProducer (Track F.2).
 *
 * Replaces the old three-stage direct chain (ingest→transcribe→analyze)
 * with a FlowProducer job graph:
 *   transcribe + diarize (parallel) → normalize_turns → extract → embed
 *
 * The ingest job itself handles audio acquisition (YouTube/Xiaoyuzhou/download),
 * then calls addProcessingFlow() with the resolved audioPath so the
 * transcribe and diarize children can consume it.
 */

import { prisma } from '@/lib/prisma';
import { addProcessingFlow } from '@/lib/queue/flow';
import { YouTubeClient } from '@/lib/youtube/client';
import { parseYouTubeUrl } from '@/lib/youtube/parser';
import { downloadAudioFromUrl } from '@/lib/youtube/downloader';
import { downloadAudio as ytDlpDownload, getVideoMeta } from '@/lib/youtube/ytdlp';
import { getEpisode } from '@/lib/xiaoyuzhou/client';
import { createFromEpisode } from '@/lib/adapters/episode-to-conversation';
import { logger } from '@/lib/logger';

interface IngestJobData {
  episodeId: string;
  youtubeUrl: string;
}

function isXiaoyuzhouAudioUrl(url: string): boolean {
  return url.includes('media.xyzcdn.net');
}

function isXiaoyuzhouPageUrl(url: string): boolean {
  return url.includes('xiaoyuzhoufm.com/episode/') || url.includes('xiaoyuzhoufm.com/podcast/');
}

export async function processIngestJob(data: IngestJobData): Promise<void> {
  const { episodeId, youtubeUrl } = data;

  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'DOWNLOADING' },
  });

  try {
    // Check Xiaoyuzhou page URL first — it needs audio URL resolution
    if (isXiaoyuzhouPageUrl(youtubeUrl)) {
      logger.info(`Resolving Xiaoyuzhou episode page`, { episodeId, url: youtubeUrl });
      const eid = youtubeUrl.split('/episode/')[1]?.split('?')[0];
      if (!eid) throw new Error('Could not extract episode ID from URL');
      const { episode: xyzEp } = await getEpisode(eid);
      if (!xyzEp.audioUrl) throw new Error('No audio URL found on Xiaoyuzhou page');

      logger.info(`Xiaoyuzhou audio resolved`, { episodeId, audioUrl: xyzEp.audioUrl });
      const audioPath = await downloadAudioFromUrl(xyzEp.audioUrl, episodeId);

      await prisma.episode.update({
        where: { id: episodeId },
        data: { title: xyzEp.title, description: xyzEp.description, duration: xyzEp.duration, status: 'TRANSCRIBING' },
      });

      await createFromEpisode(episodeId);

      // Enqueue processing flow (transcribe + diarize → normalize → extract)
      await addProcessingFlow({
        sourceId: episodeId,
        episodeId,
        mediaPath: audioPath,
      });
      logger.info(`Xiaoyuzhou ingest → processing flow enqueued`, { episodeId });
      return;
    }

    if (isXiaoyuzhouAudioUrl(youtubeUrl)) {
      // ── Xiaoyuzhou audio (media.xyzcdn.net direct download) ──
      logger.info(`Processing Xiaoyuzhou audio ingest`, { episodeId, url: youtubeUrl });
      const audioPath = await downloadAudioFromUrl(youtubeUrl, episodeId);
      logger.info(`Xiaoyuzhou audio downloaded`, { episodeId, path: audioPath });

      await prisma.episode.update({
        where: { id: episodeId },
        data: { status: 'TRANSCRIBING' },
      });

      await createFromEpisode(episodeId);

      // Enqueue processing flow
      await addProcessingFlow({
        sourceId: episodeId,
        episodeId,
        mediaPath: audioPath,
      });
      logger.info(`Xiaoyuzhou ingest → processing flow enqueued`, { episodeId });
      return;
    }

    // ── YouTube video ──
    const parsed = parseYouTubeUrl(youtubeUrl);

    if (parsed.type === 'video') {
      try {
        // Use yt-dlp for metadata + download (no API key needed)
        const meta = await getVideoMeta(parsed.id);
        await prisma.episode.update({
          where: { id: episodeId },
          data: { title: meta.title, description: meta.description, thumbnailUrl: meta.thumbnailUrl, duration: meta.duration, status: 'DOWNLOADING' },
        });
        const audioPath = await ytDlpDownload(parsed.id);
        await prisma.episode.update({ where: { id: episodeId }, data: { status: 'TRANSCRIBING' } });
        await createFromEpisode(episodeId);

        // Enqueue processing flow
        await addProcessingFlow({
          sourceId: episodeId,
          episodeId,
          mediaPath: audioPath,
        });
        logger.info(`YouTube ingest → processing flow enqueued via yt-dlp`, { episodeId });
      } catch (err) {
        logger.warn(`yt-dlp failed, falling back to direct YouTube API`, { error: String(err) });
        const client = new YouTubeClient(process.env.YOUTUBE_API_KEY || '');
        const video = await client.getVideo(parsed.id);
        await prisma.episode.update({
          where: { id: episodeId },
          data: { title: video.title, description: video.description, thumbnailUrl: video.thumbnailUrl, duration: parseDuration(video.duration), status: 'TRANSCRIBING' },
        });
        await createFromEpisode(episodeId);

        // Enqueue processing flow (YouTube URL path — transcribe job will download)
        await addProcessingFlow({
          sourceId: episodeId,
          episodeId,
          youtubeUrl,
        });
        logger.info(`YouTube ingest → processing flow enqueued via API`, { episodeId });
      }
    } else {
      throw new Error(`Unsupported URL type in ingest job: ${parsed.type}`);
    }
  } catch (error) {
    logger.error(`Ingest job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}

function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
