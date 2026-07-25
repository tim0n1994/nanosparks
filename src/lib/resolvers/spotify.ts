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
      const hit = await findFeedByTitle(title, ctx.signal);
      if (hit?.feedUrl) {
        // Found a same-name RSS feed on another platform. We cannot auto-confirm it is
        // the same show, so return a hint the UI can surface for user confirmation.
        return {
          platform: 'spotify',
          platformId: url,
          episodeKey: `spotify:${url}`,
          title: title,
          description: `Spotify 独占内容。检测到同名节目 RSS 源，请确认是否同一节目后使用该 RSS 链接。`,
          audioUrl: hit.feedUrl, // hint: the matching RSS feedUrl
          coverUrl: hit.artworkUrl600,
          showTitle: title,
          sourceUrl: url,
          isMultiEpisode: true,
          episodes: [],
        };
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
