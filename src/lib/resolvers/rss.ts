/**
 * Generic RSS feed resolver (A1).
 *
 * A direct podcast feed URL (or any URL whose content-type is application/rss+xml).
 * Show feed → isMultiEpisode (recent N episodes for the user to pick).
 */

import { parseRssFeed } from './rss-parser';
import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey } from './episode-key';

/** Heuristic: does this URL look like a podcast feed (or is the host a known feed host)? */
const FEED_HOST_HINTS = ['feed', 'rss', 'anchor.fm', 'buzzsprout', 'transistor', 'podbean', 'fireside'];
const FEED_EXTENSIONS = ['.rss', '.xml'];

function looksLikeFeedHost(host: string): boolean {
  const low = host.toLowerCase();
  return FEED_HOST_HINTS.some((h) => low.includes(h));
}

/**
 * canHandle is conservative: RSS is low-confidence from the URL alone, so we sniff
 * the Content-Type header here rather than in canHandle (which must stay cheap & sync).
 * The chain calls canHandle → resolve; RSS puts its real accept logic in a probe.
 */
export async function isRssFeed(url: string, signal?: AbortSignal): Promise<boolean> {
  let resp;
  try {
    // HEAD first; fall back to a small GET if the server doesn't support HEAD.
    resp = await fetch(url, {
      method: 'HEAD',
      signal,
      headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)' },
      redirect: 'follow',
    });
    if (resp.status === 405 || resp.status === 501) {
      resp = await fetch(url, {
        signal,
        headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)', Range: 'bytes=0-2047' },
        redirect: 'follow',
      });
    }
  } catch {
    return false;
  }
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  return ct.includes('rss') || ct.includes('xml');
}

export const rssResolver: Resolver = {
  name: 'rss',
  canHandle(url) {
    try {
      const u = new URL(url);
      if (looksLikeFeedHost(u.hostname)) return true;
      return FEED_EXTENSIONS.some((ext) => u.pathname.toLowerCase().endsWith(ext));
    } catch {
      return false;
    }
  },
  async resolve(url, ctx: ResolveCtx) {
    let feed;
    try {
      feed = await parseRssFeed(url, ctx.signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResolverError(`RSS 源解析失败：${msg}`, 'unknown', 'rss');
    }
    if (feed.episodes.length === 0) {
      throw new ResolverError('RSS 源里没有可下载的单集', 'no_audio', 'rss');
    }

    const showId = buildEpisodeKey('rss', url);
    const episodes = feed.episodes.slice(0, 20).map((e) => ({
      platform: 'rss' as const,
      platformId: e.guid || e.enclosureUrl,
      episodeKey: buildEpisodeKey('rss', e.guid || e.enclosureUrl),
      title: e.title,
      description: e.description,
      audioUrl: e.enclosureUrl,
      durationSec: e.durationSec,
      coverUrl: feed.image,
      showTitle: feed.title,
      sourceUrl: url,
    }));

    return {
      platform: 'rss',
      platformId: url,
      episodeKey: showId,
      title: feed.title,
      description: feed.description,
      audioUrl: '', // feed-level: no single audio
      coverUrl: feed.image,
      showTitle: feed.title,
      sourceUrl: url,
      isMultiEpisode: true,
      episodes,
    };
  },
};
