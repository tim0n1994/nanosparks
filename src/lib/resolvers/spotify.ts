/**
 * Spotify resolver (A1).
 *
 * Spotify does NOT provide episode audio for third parties. Per PRD §A1 the flow is:
 *   URL → oEmbed (episode/show name) → iTunes Search for same-name RSS
 *     → found → ask user to confirm same show
 *     → not found → ResolverError(spotify_exclusive) with a clear human message.
 *
 * canHandle always matches open.spotify.com so the chain routes here, but resolve
 * almost always surfaces a ResolverError explaining Spotify exclusivity.
 */

import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { discoverFeed } from './discover';
import { parseRssFeed } from './rss-parser';
import { buildEpisodeKey } from './episode-key';
import type { OpenAIClient } from '@/lib/llm/client';
import { OpenAIClient as MakeOpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';

const SPOTIFY_HOSTS = ['open.spotify.com'];
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

interface SpotifyOEmbed {
  title?: string;
  provider_name?: string;
  type?: string;
}

interface ItunesSearchResult {
  collectionName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
}
interface ItunesSearchResponse {
  resultCount: number;
  results: ItunesSearchResult[];
}

/** Fetch Spotify oEmbed metadata (title + type) for an episode/show URL. */
async function getSpotifyOEmbed(url: string, signal?: AbortSignal): Promise<SpotifyOEmbed> {
  const oembed = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  // Network failures (DNS/timeout/connection reset) must surface as a classified
  // ResolverError, never a bare TypeError → 500. Spotify's CDN is occasionally
  // flaky, so a clear "retry" message beats Internal error.
  let resp: Response;
  try {
    resp = await fetch(oembed, { signal });
  } catch (e) {
    throw new ResolverError(
      `Spotify 元数据请求失败（网络超时）。请稍后重试。`,
      'unknown', 'spotify', { cause: e },
    );
  }
  if (!resp.ok) {
    throw new ResolverError(
      `Spotify 元数据获取失败 (${resp.status})。该链接可能无效或地区受限。`,
      resp.status === 404 ? 'not_found' : 'unknown', 'spotify',
    );
  }
  return (await resp.json()) as SpotifyOEmbed;
}

/** Search iTunes for a podcast feed matching a title. Returns best hit or null. */
async function findFeedByTitle(title: string, signal?: AbortSignal): Promise<ItunesSearchResult | null> {
  const u = new URL(ITUNES_SEARCH);
  u.searchParams.set('media', 'podcast');
  u.searchParams.set('entity', 'podcast');
  u.searchParams.set('limit', '5');
  u.searchParams.set('term', title);
  // iTunes is the only public path to a Spotify show's RSS; if it's down we
  // cannot determine exclusivity, so treat as unknown (not exclusive).
  let resp: Response;
  try {
    resp = await fetch(u.toString(), { signal });
  } catch {
    return null; // iTunes unreachable → can't confirm/deny; let caller report generic failure
  }
  if (!resp.ok) return null;
  const data = (await resp.json()) as ItunesSearchResponse;
  return data.results?.find((r) => r.feedUrl) ?? null;
}

export const spotifyResolver: Resolver = {
  name: 'spotify',
  canHandle(url) {
    try {
      return SPOTIFY_HOSTS.includes(new URL(url).hostname);
    } catch {
      return false;
    }
  },
  async resolve(url, ctx: ResolveCtx) {
    const oembed = await getSpotifyOEmbed(url, ctx.signal);
    const title = oembed.title?.trim();
    const isShowUrl = /\/show\//.test(url);
    const isVideo = oembed.type === 'video';

    if (title) {
      // Agentic discovery: exact iTunes same-name hit (cheap), then escalate to
      // LLM-arbitrated search across candidates. If a feed is found, parse it
      // into a real multi-episode list the user can pick from — no manual
      // "go find the RSS" step.
      const discovered = await discoverFeed(title, {
        author: oembed.provider_name,
        client: await makeAgentClient(),
        signal: ctx.signal,
      }).catch(() => null);
      if (discovered) {
        return await buildShowFromFeed(discovered.feedUrl, url, title, ctx.signal);
      }
    }

    // No matching feed found → exclusive content, cannot fetch audio.
    // Give an actionable message: how the user can still get it in.
    throw new ResolverError(
      buildExclusiveMessage(isShowUrl, isVideo, title),
      'spotify_exclusive',
      'spotify',
    );
  },
};


/** Build a multi-episode ResolvedEpisode from a discovered RSS feed. */
async function buildShowFromFeed(
  feedUrl: string,
  sourceUrl: string,
  spotifyTitle: string,
  signal?: AbortSignal,
) {
  const feed = await parseRssFeed(feedUrl, signal).catch(() => null);
  if (!feed || feed.episodes.length === 0) {
    // Feed exists but couldn't be parsed — still surface the feed URL.
    return {
      platform: 'rss' as const,
      platformId: feedUrl,
      episodeKey: buildEpisodeKey('rss', feedUrl),
      title: spotifyTitle,
      description: `Spotify 节目「${spotifyTitle}」找到 RSS 源但解析失败，请直接使用该链接：${feedUrl}`,
      audioUrl: feedUrl,
      coverUrl: undefined,
      showTitle: feed?.title ?? spotifyTitle,
      sourceUrl,
      isMultiEpisode: true,
      episodes: [],
    };
  }
  return {
    platform: 'rss' as const,
    platformId: feedUrl,
    episodeKey: buildEpisodeKey('rss', feedUrl),
    title: feed.title || spotifyTitle,
    description: `Spotify 节目「${spotifyTitle}」→ 自动发现 RSS 源并解析为选集列表`,
    audioUrl: feedUrl,
    coverUrl: feed.image,
    showTitle: feed.title || spotifyTitle,
    sourceUrl,
    isMultiEpisode: true,
    episodes: feed.episodes.slice(0, 20).map((e) => ({
      platform: 'rss' as const,
      platformId: e.guid || e.enclosureUrl,
      episodeKey: buildEpisodeKey('rss', e.guid || e.enclosureUrl),
      title: e.title,
      description: e.description,
      audioUrl: e.enclosureUrl,
      durationSec: e.durationSec,
      coverUrl: feed.image,
      showTitle: feed.title || spotifyTitle,
      sourceUrl: e.enclosureUrl,
    })),
  };
}

/** Lazily build the LLM client for agent arbitration (no cost on exact match). */
async function makeAgentClient(): Promise<OpenAIClient | undefined> {
  try {
    const s = await getLlmSettings();
    if (s.apiFormat === 'anthropic') return undefined; // arbitration needs OpenAI-shape; else heuristic fallback
    return new MakeOpenAIClient(s.apiKey, s.model, s.baseUrl);
  } catch {
    return undefined;
  }
}

/**
 * Build an actionable "can't fetch from Spotify" message. Tells the user the
 * three concrete alternatives (RSS / Apple / 小宇宙) rather than just "exclusive".
 */
function buildExclusiveMessage(isShow: boolean, isVideo: boolean, title?: string): string {
  const what = isShow ? '节目' : '单集';
  const videoNote = isVideo ? '（Spotify 标记为视频内容，可能为视频独占）' : '';
  return [
    `无法从 Spotify 获取这${what}的音频${title ? `「${title}」` : ''}${videoNote}。`,
    'Spotify 不向第三方提供音频。请改用以下任一来源的链接：',
    '• 该节目的 RSS 订阅地址',
    '• Apple Podcasts 链接',
    '• 小宇宙 / 其他播客平台链接',
  ].join('\n');
}
