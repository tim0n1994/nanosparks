/**
 * YouTube resolver (A1).
 *
 * Single video → ResolvedEpisode (audio downloaded later by the ingest job).
 * Channel/playlist URLs resolve to isMultiEpisode + episodes[] via the YouTube
 * Data API client when a key is configured; otherwise (or on API failure) they
 * fall back to yt-dlp's zero-key channel/playlist listing. yt-dlp handles the
 * actual audio acquisition downstream in both paths.
 */

import { parseYouTubeUrl } from '@/lib/youtube/parser';
import { getVideoMeta } from '@/lib/youtube/ytdlp';
import { listChannelVideos, getChannelMeta, getPlaylistMeta } from '@/lib/youtube/channel';
import { YouTubeClient } from '@/lib/youtube/client';
import type { Resolver, ResolvedEpisode, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey } from './episode-key';

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'];

/**
 * Channel/playlist lookups go through the YouTube Data API, which needs an API
 * key and resolves @handles / vanity names server-side. Wrap failures as
 * ResolverError so the user sees a classified message, never a bare 500.
 */
function classifyYouTubeError(cause: unknown): ResolverError {
  const msg = String((cause as Error)?.message ?? cause);
  const kind = /not found/i.test(msg) ? 'not_found' : 'unknown';
  const hint = /API error: 40/.test(msg)
    ? '（YouTube Data API 未配置或配额耗尽；频道/播放列表需要 API key，单集仍可用）'
    : '';
  return new ResolverError(
    `无法解析 YouTube 频道/播放列表${hint}`,
    kind,
    'youtube',
    { cause },
  );
}

export const youtubeResolver: Resolver = {
  name: 'youtube',
  canHandle(url) {
    try {
      return YT_HOSTS.includes(new URL(url).hostname);
    } catch {
      return false;
    }
  },
  async resolve(url, _ctx: ResolveCtx): Promise<ResolvedEpisode> {
    const parsed = parseYouTubeUrl(url);

    if (parsed.type === 'video') {
      const meta = await getVideoMeta(parsed.id);
      return {
        platform: 'youtube',
        platformId: parsed.id,
        episodeKey: buildEpisodeKey('youtube', parsed.id),
        title: meta.title,
        description: meta.description,
        audioUrl: `https://www.youtube.com/watch?v=${parsed.id}`,
        durationSec: meta.duration || undefined,
        coverUrl: meta.thumbnailUrl,
        showTitle: meta.channelTitle,
        sourceUrl: url,
      };
    }

    // channel → recent videos (multi-episode). API-first, yt-dlp fallback.
    if (parsed.type === 'channel') {
      try {
        const result = await resolveChannel(parsed.id);
        const episodes: ResolvedEpisode[] = result.videos.map((v) => ({
          platform: 'youtube' as const,
          platformId: v.id,
          episodeKey: buildEpisodeKey('youtube', v.id),
          title: v.title,
          description: '',
          audioUrl: `https://www.youtube.com/watch?v=${v.id}`,
          coverUrl: v.thumbnailUrl,
          showTitle: result.title,
          sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
        }));
        return {
          platform: 'youtube',
          platformId: parsed.id,
          episodeKey: buildEpisodeKey('youtube', parsed.id),
          title: result.title,
          description: result.description,
          audioUrl: '',
          coverUrl: result.coverUrl,
          showTitle: result.title,
          sourceUrl: url,
          isMultiEpisode: true,
          episodes,
        };
      } catch (err) {
        throw classifyYouTubeError(err);
      }
    }

    // Playlist → multi-episode list. API-first, yt-dlp fallback.
    if (parsed.type === 'playlist') {
      try {
        const result = await resolvePlaylist(parsed.id);
        const episodes: ResolvedEpisode[] = result.videos.map((v) => ({
          platform: 'youtube' as const,
          platformId: v.id,
          episodeKey: buildEpisodeKey('youtube', v.id),
          title: v.title,
          description: '',
          audioUrl: `https://www.youtube.com/watch?v=${v.id}`,
          coverUrl: v.thumbnailUrl,
          showTitle: result.title,
          sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
        }));
        return {
          platform: 'youtube',
          platformId: parsed.id,
          episodeKey: buildEpisodeKey('youtube', parsed.id),
          title: result.title,
          audioUrl: '',
          coverUrl: result.videos[0]?.thumbnailUrl || '',
          showTitle: result.title,
          sourceUrl: url,
          isMultiEpisode: true,
          episodes,
        };
      } catch (err) {
        throw classifyYouTubeError(err);
      }
    }

    throw new Error(`Unsupported YouTube URL type`);
  },
};


/** Resolve a channel (title + videos): Data API first, yt-dlp fallback (zero key). */
async function resolveChannel(channelId: string): Promise<{ title: string; description: string; coverUrl: string; videos: { id: string; title: string; thumbnailUrl: string }[] }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (key && key !== 'placeholder') {
    try {
      const client = new YouTubeClient(key);
      const channelData = await client.getChannel(channelId);
      const videos = await client.getChannelVideos(channelId, 10);
      return {
        title: channelData.title,
        description: channelData.description,
        coverUrl: channelData.thumbnailUrl,
        videos: videos.map((v) => ({ id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl })),
      };
    } catch {
      /* fall through to yt-dlp */
    }
  }
  const [meta, vids] = await Promise.all([getChannelMeta(channelId), listChannelVideos(channelId, 10)]);
  return {
    title: meta.title,
    description: meta.description,
    coverUrl: meta.thumbnailUrl,
    videos: vids.map((v) => ({ id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl })),
  };
}

/** Resolve a playlist (title + videos): Data API first, yt-dlp fallback. */
async function resolvePlaylist(playlistId: string): Promise<{ title: string; videos: { id: string; title: string; thumbnailUrl: string }[] }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (key && key !== 'placeholder') {
    try {
      const client = new YouTubeClient(key);
      const playlist = await client.getPlaylist(playlistId);
      return { title: playlist.title, videos: playlist.videos.map((v) => ({ id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl })) };
    } catch {
      /* fall through to yt-dlp */
    }
  }
  const pl = await getPlaylistMeta(playlistId, 20);
  return { title: pl.title, videos: pl.videos.map((v) => ({ id: v.id, title: v.title, thumbnailUrl: v.thumbnailUrl })) };
}
