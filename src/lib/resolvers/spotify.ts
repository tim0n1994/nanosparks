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
  const resp = await fetch(oembed, { signal });
  if (!resp.ok) throw new ResolverError(`Spotify 元数据获取失败: ${resp.status}`, 'unknown', 'spotify');
  return (await resp.json()) as SpotifyOEmbed;
}

/** Search iTunes for a podcast feed matching a title. Returns best hit or null. */
async function findFeedByTitle(title: string, signal?: AbortSignal): Promise<ItunesSearchResult | null> {
  const u = new URL(ITUNES_SEARCH);
  u.searchParams.set('media', 'podcast');
  u.searchParams.set('entity', 'podcast');
  u.searchParams.set('limit', '5');
  u.searchParams.set('term', title);
  const resp = await fetch(u.toString(), { signal });
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
    throw new ResolverError(
      'Spotify 独占内容无法获取音频。请尝试其他平台（Apple Podcasts / 小宇宙 / RSS）的链接。',
      'spotify_exclusive',
      'spotify',
    );
  },
};
