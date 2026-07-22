/**
 * Apple Podcasts resolver (A1).
 *
 * Flow per PRD §A1:
 *   URL → extract id (podcast /album id or episode ?i= guid)
 *     → iTunes Lookup API (/lookup?id=) → feedUrl (RSS)
 *     → parse RSS → match single episode by ?i= guid, else by title+duration.
 * Lookup is free and keyless; the RSS enclosure is the real audio URL.
 */

import { parseRssFeed, type RssEpisode } from './rss-parser';
import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey } from './episode-key';

const APPLE_HOSTS = ['podcasts.apple.com', 'music.apple.com'];
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

interface ItunesResult {
  collectionId?: number;
  trackId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl600?: string;
  feedUrl?: string;
}
interface ItunesResponse {
  resultCount: number;
  results: ItunesResult[];
}

/** Pull the numeric Apple id and optional episode guid (?i=) from a URL. */
function parseAppleUrl(url: string): { id: string; episodeGuid?: string } {
  const u = new URL(url);
  const guid = u.searchParams.get('i') ?? undefined;
  // /podcast/{slug}/id1234567890  OR  /us/podcast/{slug}/id1234567890
  const m = u.pathname.match(/id(\d+)/);
  if (!m) throw new ResolverError('无法识别 Apple Podcasts 链接', 'unknown', 'apple_podcasts');
  return { id: m[1], episodeGuid: guid };
}

/** Resolve a podcast id to its RSS feedUrl via the iTunes Lookup API. */
async function lookupFeedUrl(id: string, signal?: AbortSignal): Promise<ItunesResult> {
  const resp = await fetch(`${ITUNES_LOOKUP}?id=${id}`, { signal });
  if (!resp.ok) throw new ResolverError(`iTunes Lookup 失败: ${resp.status}`, 'unknown', 'apple_podcasts');
  const data = (await resp.json()) as ItunesResponse;
  if (!data.results?.[0]) {
    throw new ResolverError('Apple Podcasts 节目未找到', 'not_found', 'apple_podcasts');
  }
  return data.results[0];
}

/** Match a single episode from an RSS feed by guid, else by closest title+duration. */
function matchEpisode(feed: RssEpisode[], guid?: string, title?: string, durationSec?: number): RssEpisode | null {
 if (guid) {
    const hit = feed.find((e) => e.guid === guid);
    if (hit) return hit;
  }
  if (title) {
    const lower = title.toLowerCase();
    let best: RssEpisode | null = null;
    let bestScore = -1;
    for (const ep of feed) {
      const score = ep.title.toLowerCase().includes(lower) ? 1 : 0;
      const durDelta =
        durationSec && ep.durationSec ? Math.abs(durationSec - ep.durationSec) : Number.MAX_SAFE_INTEGER;
      const combined = score * 1000 - durDelta;
      if (combined > bestScore) {
        bestScore = combined;
        best = ep;
      }
    }
    if (best && bestScore >= 0) return best;
  }
  return null;
}

export const appleResolver: Resolver = {
  name: 'apple_podcasts',
  canHandle(url) {
    try {
      return APPLE_HOSTS.includes(new URL(url).hostname);
    } catch {
      return false;
    }
  },
  async resolve(url, ctx: ResolveCtx) {
    const { id, episodeGuid } = parseAppleUrl(url);
    const result = await lookupFeedUrl(id, ctx.signal);
    if (!result.feedUrl) {
      throw new ResolverError('该 Apple 节目没有可用的 RSS 源', 'no_audio', 'apple_podcasts');
    }
    const feed = await parseRssFeed(result.feedUrl, ctx.signal);
    const ep = matchEpisode(feed.episodes, episodeGuid, undefined, undefined);
    if (!ep) {
      // No specific episode matched → return show as multi-episode so the user can pick.
      return {
        platform: 'apple_podcasts',
        platformId: id,
        episodeKey: buildEpisodeKey('apple_podcasts', id),
        title: result.collectionName || 'Apple Podcasts 节目',
        description: feed.description,
        audioUrl: '',
        coverUrl: result.artworkUrl600 || feed.image,
        showTitle: result.collectionName || result.artistName,
        sourceUrl: url,
        isMultiEpisode: true,
        episodes: feed.episodes.map((e) => ({
          platform: 'apple_podcasts' as const,
          platformId: e.guid || e.enclosureUrl,
          episodeKey: buildEpisodeKey('apple_podcasts', e.guid || e.enclosureUrl),
          title: e.title,
          description: e.description,
          audioUrl: e.enclosureUrl,
          durationSec: e.durationSec,
          coverUrl: feed.image,
          showTitle: feed.title,
          sourceUrl: url,
        })),
      };
    }

    return {
      platform: 'apple_podcasts',
      platformId: ep.guid || id,
      episodeKey: buildEpisodeKey('apple_podcasts', ep.guid || id),
      title: ep.title,
      description: ep.description,
      audioUrl: ep.enclosureUrl,
      durationSec: ep.durationSec,
      coverUrl: feed.image,
      showTitle: feed.title,
      sourceUrl: url,
    };
  },
};
