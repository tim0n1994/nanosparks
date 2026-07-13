import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';
import { addIngestJob } from '@/lib/queue/config';
import { YouTubeClient } from '@/lib/youtube/client';
import { parseYouTubeUrl } from '@/lib/youtube/parser';
import { getVideoMeta as getYtDlpMeta } from '@/lib/youtube/ytdlp';
import { getPodcast, getEpisode } from '@/lib/xiaoyuzhou/client';
import { isXiaoyuzhouUrl, parseXiaoyuzhouUrl } from '@/lib/xiaoyuzhou/parser';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';

const ingestSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['robot', 'creator', 'ugc']),
});

export async function POST(request: NextRequest) {
  try {
    // Authentication check — skip when Clerk is not configured (dev/E2E)
    if (isValidClerkKey) {
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
    const rateResult = await rateLimit(ip, 'ingest');
    if (!rateResult.success) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { url, mode } = ingestSchema.parse(body);

    // ── Xiaoyuzhou FM ──
    if (isXiaoyuzhouUrl(url)) {
      return handleXiaoyuzhou(url, mode);
    }

    // ── YouTube ──
    const parsed = parseYouTubeUrl(url);
    const client = new YouTubeClient(process.env.YOUTUBE_API_KEY || '');

    if (parsed.type === 'channel') {
      const channelData = await client.getChannel(parsed.id);
      const channel = await prisma.channel.upsert({
        where: { youtubeId: parsed.id },
        update: { title: channelData.title, description: channelData.description, thumbnailUrl: channelData.thumbnailUrl },
        create: { youtubeId: parsed.id, title: channelData.title, description: channelData.description, thumbnailUrl: channelData.thumbnailUrl },
      });

      const videos = await client.getChannelVideos(parsed.id, 10);
      const episodeIds: string[] = [];

      for (const video of videos) {
        const episode = await prisma.episode.upsert({
          where: { youtubeId: video.id },
          update: {},
          create: {
            youtubeId: video.id,
            title: video.title,
            description: video.description,
            duration: parseDuration(video.duration),
            thumbnailUrl: video.thumbnailUrl,
            channelId: channel.id,
            status: 'PENDING',
          },
        });
        episodeIds.push(episode.id);
        await addIngestJob({ episodeId: episode.id, youtubeUrl: `https://youtube.com/watch?v=${video.id}` });
      }

      logger.info(`Channel ingest started`, { channelId: channel.id, episodes: episodeIds.length, mode });
      return NextResponse.json({ success: true, episodeIds, channelId: channel.id });
    }

    if (parsed.type === 'video') {
      // Use yt-dlp for video metadata (no API key needed)
      const video = await getYtDlpMeta(parsed.id);

      // Create channel record
      const channel = await prisma.channel.upsert({
        where: { youtubeId: video.channelId },
        update: { title: video.channelTitle, thumbnailUrl: video.thumbnailUrl },
        create: { youtubeId: video.channelId, title: video.channelTitle, thumbnailUrl: video.thumbnailUrl },
      });

      const episode = await prisma.episode.upsert({
        where: { youtubeId: parsed.id },
        update: { title: video.title, description: video.description, duration: video.duration, thumbnailUrl: video.thumbnailUrl, channelId: channel.id },
        create: {
          youtubeId: parsed.id,
          title: video.title,
          description: video.description,
          duration: video.duration,
          thumbnailUrl: video.thumbnailUrl,
          channelId: channel.id,
          status: 'PENDING',
        },
      });
      await addIngestJob({ episodeId: episode.id, youtubeUrl: url });
      logger.info(`YouTube video ingest started`, { episodeId: episode.id, title: video.title });
      return NextResponse.json({ success: true, episodeIds: [episode.id] });
    }

    return NextResponse.json({ success: false, error: 'Playlist support coming soon' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.issues }, { status: 400 });
    }
    logger.error('Ingest API error', { error: String(error) });
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Handle Xiaoyuzhou podcast import.
 * Scrapes the podcast page to extract metadata and episodes.
 */
async function handleXiaoyuzhou(url: string, mode: string) {
  const parsed = parseXiaoyuzhouUrl(url);

  if (parsed.type === 'episode') {
    return handleXiaoyuzhouEpisode(parsed.id, mode);
  }

  // ── Podcast (multiple episodes) ──
  let podcast, episodes;
  try {
    ({ podcast, episodes } = await getPodcast(parsed.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Xiaoyuzhou fetch failed', { error: msg, pid: parsed.id });

    if (msg.includes('404') || msg.includes('No podcast data found')) {
      return NextResponse.json(
        { success: false, error: 'Podcast not found — the URL may be invalid or the podcast has been removed' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: false, error: `Failed to fetch Xiaoyuzhou podcast: ${msg}` },
      { status: 502 },
    );
  }

  if (episodes.length === 0) {
    return NextResponse.json({ success: false, error: 'No episodes found for this podcast' }, { status: 404 });
  }

  // Create a synthetic Channel record using the Xiaoyuzhou pid
  const channel = await prisma.channel.upsert({
    where: { youtubeId: `xyz_${podcast.pid}` },
    update: {
      title: podcast.title,
      description: podcast.description,
      thumbnailUrl: podcast.image,
    },
    create: {
      youtubeId: `xyz_${podcast.pid}`,
      title: podcast.title,
      description: podcast.description,
      thumbnailUrl: podcast.image,
    },
  });

  const episodeIds: string[] = [];

  for (const ep of episodes) {
    const episode = await prisma.episode.upsert({
      where: { youtubeId: `xyz_${ep.eid}` },
      update: {},
      create: {
        youtubeId: `xyz_${ep.eid}`,
        title: ep.title,
        description: ep.description,
        duration: ep.duration,
        thumbnailUrl: ep.image || podcast.image,
        channelId: channel.id,
        status: 'PENDING',
      },
    });
    episodeIds.push(episode.id);
    await addIngestJob({ episodeId: episode.id, youtubeUrl: ep.audioUrl });
  }

  logger.info(`Xiaoyuzhou ingest started`, {
    podcast: podcast.title,
    episodes: episodeIds.length,
    mode,
  });

  return NextResponse.json({ success: true, episodeIds, channelId: channel.id });
}

/**
 * Handle single Xiaoyuzhou episode import.
 */
async function handleXiaoyuzhouEpisode(eid: string, mode: string) {
  let podcast, episode;
  try {
    ({ podcast, episode } = await getEpisode(eid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Xiaoyuzhou episode fetch failed', { error: msg, eid });

    if (msg.includes('404') || msg.includes('No episode data found')) {
      return NextResponse.json(
        { success: false, error: 'Episode not found — the URL may be invalid or the episode has been removed' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: false, error: `Failed to fetch Xiaoyuzhou episode: ${msg}` },
      { status: 502 },
    );
  }

  const channel = await prisma.channel.upsert({
    where: { youtubeId: `xyz_${podcast.pid}` },
    update: {
      title: podcast.title,
      description: podcast.description,
      thumbnailUrl: podcast.image,
    },
    create: {
      youtubeId: `xyz_${podcast.pid}`,
      title: podcast.title,
      description: podcast.description,
      thumbnailUrl: podcast.image,
    },
  });

  const episodeRecord = await prisma.episode.upsert({
    where: { youtubeId: `xyz_${episode.eid}` },
    update: {},
    create: {
      youtubeId: `xyz_${episode.eid}`,
      title: episode.title,
      description: episode.description,
      duration: episode.duration,
      thumbnailUrl: episode.image || podcast.image,
      channelId: channel.id,
      status: 'PENDING',
    },
  });

  await addIngestJob({ episodeId: episodeRecord.id, youtubeUrl: episode.audioUrl });

  logger.info(`Xiaoyuzhou single episode ingest started`, {
    episode: episode.title,
    podcast: podcast.title,
    mode,
  });

  return NextResponse.json({ success: true, episodeIds: [episodeRecord.id], channelId: channel.id });
}

function parseDuration(isoDuration: string): number {
  const match = isoDuration.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
