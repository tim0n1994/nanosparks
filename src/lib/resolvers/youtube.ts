/**
 * YouTube resolver (A1).
 *
 * Single video → ResolvedEpisode (audio downloaded later by the ingest job).
 * Channel/playlist URLs resolve to isMultiEpisode + episodes[] via the YouTube
 * Data API client. yt-dlp handles the actual audio acquisition downstream.
 */

import { parseYouTubeUrl } from '@/lib/youtube/parser';
import { getVideoMeta } from '@/lib/youtube/ytdlp';
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

    // channel → recent videos (multi-episode)
    if (parsed.type === 'channel') {
      try {
        const client = new YouTubeClient(process.env.YOUTUBE_API_KEY || '');
        const channelData = await client.getChannel(parsed.id);
        const videos = await client.getChannelVideos(parsed.id, 10);
      const episodes: ResolvedEpisode[] = videos.map((v) => ({
        platform: 'youtube' as const,
        platformId: v.id,
        episodeKey: buildEpisodeKey('youtube', v.id),
        title: v.title,
        description: v.description,
        audioUrl: `https://www.youtube.com/watch?v=${v.id}`,
        coverUrl: v.thumbnailUrl,
        showTitle: channelData.title,
        sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
      }));
      return {
        platform: 'youtube',
        platformId: parsed.id,
        episodeKey: buildEpisodeKey('youtube', parsed.id),
        title: channelData.title,
        description: channelData.description,
        audioUrl: '',
        coverUrl: channelData.thumbnailUrl,
        showTitle: channelData.title,
        sourceUrl: url,
        isMultiEpisode: true,
        episodes,
      };
      } catch (err) {
        throw classifyYouTubeError(err);
      }
    }

    // Playlist → multi-episode list (PRD §A1 resolver chain).
    if (parsed.type === 'playlist') {
      try {
        const client = new YouTubeClient(process.env.YOUTUBE_API_KEY || '');
        const playlist = await client.getPlaylist(parsed.id);
        const episodes: ResolvedEpisode[] = playlist.videos.map((v) => ({
        platform: 'youtube' as const,
        platformId: v.id,
        episodeKey: buildEpisodeKey('youtube', v.id),
        title: v.title,
        description: v.description,
        audioUrl: `https://www.youtube.com/watch?v=${v.id}`,
        coverUrl: v.thumbnailUrl,
        showTitle: playlist.title,
        sourceUrl: `https://www.youtube.com/watch?v=${v.id}`,
      }));
      return {
        platform: 'youtube',
        platformId: parsed.id,
        episodeKey: buildEpisodeKey('youtube', parsed.id),
        title: playlist.title,
        audioUrl: '',
        coverUrl: playlist.videos[0]?.thumbnailUrl,
        showTitle: playlist.title,
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
