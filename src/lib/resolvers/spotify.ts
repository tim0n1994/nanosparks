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
    // Spotify oEmbed can hang on flaky networks; cap it so the agent doesn't
    // stall. 8s is generous (a healthy request is <1s).
    resp = await fetch(oembed, {
      signal: signal ?? AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)' },
    });
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

/**
 * oEmbed with one retry and an 8s cap per attempt. open.spotify.com is flaky on
 * some networks; a single transient timeout shouldn't abort the whole resolve.
 */
async function getSpotifyOEmbedWithRetry(url: string): Promise<SpotifyOEmbed> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getSpotifyOEmbed(url, AbortSignal.timeout(8000));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Extract the real SHOW name from a Spotify show page. oEmbed for /show/ URLs
 * returns the *current episode* title, not the show name — useless for finding
 * the podcast on iTunes. The show page's <title>/og:title carries the actual
 * show name ("The Ezra Klein Show | Podcast on Spotify"). Best-effort: returns
 * null if the page can't be fetched/parsed.
 */
async function getShowNameFromPage(showId: string): Promise<string | null> {
  const pageUrl = `https://open.spotify.com/show/${showId}`;
  try {
    const resp = await fetch(pageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)' },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // og:title is cleanest ("The Ezra Klein Show"); <title> has a " | Podcast
    // on Spotify" suffix we strip.
    const og = html.match(/og:title"[^>]*content="([^"]+)"/i)?.[1];
    if (og) return og;
    const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    return titleTag.replace(/\s*\|\s*Podcast on Spotify\s*$/i, '').trim() || null;
  } catch {
    return null;
  }
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
    const isShowUrl = /\/show\//.test(url);
    const showId = isShowUrl ? url.match(/\/show\/([a-zA-Z0-9]+)/)?.[1] : null;

    // Spotify's oEmbed for /show/ URLs returns the *current episode* title, not
    // the show name — useless for iTunes discovery. So for shows we race two
    // independent fetches (show-page HTML name + oEmbed) and use whichever wins:
    // the page name is authoritative for discovery; oEmbed still gives the type
    // hint. Both hit open.spotify.com (flaky on some networks), so we retry once
    // and cap timeouts; if BOTH fail we surface a clear retry message.
    let showName: string | null = null;
    let oembedTitle: string | null = null;
    let isVideo = false;

    const pagePromise = showId
      ? getShowNameFromPage(showId).then((n) => { showName = n; })
      : Promise.resolve();
    const oembedPromise = getSpotifyOEmbedWithRetry(url)
      .then((oe) => { oembedTitle = oe.title?.trim() || null; isVideo = oe.type === 'video'; })
      .catch(() => { /* allowed to fail if showName comes through */ });
    await Promise.all([pagePromise, oembedPromise]);

    const title = showName ?? oembedTitle;
    if (!title) {
      throw new ResolverError(
        'Spotify 暂时无法访问（网络超时）。请稍后重试，或直接粘贴该节目的 RSS / Apple Podcasts 链接。',
        'platform_unreachable', 'spotify',
      );
    }

        if (title) {
      // Agentic discovery: exact iTunes same-name hit (cheap), then escalate to
      // LLM-arbitrated search across candidates. If a feed is found, parse it
      // into a real multi-episode list the user can pick from — no manual
      // "go find the RSS" step.
      const discovered = await discoverFeed(title, {
        author: undefined,
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
function buildExclusiveMessage(isShow: boolean, isVideo: boolean, title: string | null): string {
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
