/**
 * Resolver Chain — single entry point (A1).
 *
 * Replaces the inline if/else branching that used to live in the ingest route.
 * Resolvers are tried in priority order; the first whose `canHandle(url)` is true
 * is asked to `resolve`. The generic yt-dlp resolver is always last and always
 * accepts, so the chain never returns "unsupported" without a classified error.
 *
 * Order matters: host-specific resolvers (xiaoyuzhou/youtube/bilibili/apple/
 * spotify) must run before low-confidence ones (rss/direct), which must run before
 * the catch-all generic resolver.
 */

import { xiaoyuzhouResolver } from './xiaoyuzhou';
import { youtubeResolver } from './youtube';
import { bilibiliResolver } from './bilibili';
import { appleResolver } from './apple';
import { spotifyResolver } from './spotify';
import { rssResolver } from './rss';
import { directResolver } from './direct';
import { genericResolver } from './generic';
import type { ResolvedEpisode, ResolveCtx, Resolver, SourcePlatform } from './types';
import { ResolverError } from './types';

/** Ordered resolver list. First canHandle=true wins. */
export const RESOLVERS: Resolver[] = [
  xiaoyuzhouResolver,
  youtubeResolver,
  bilibiliResolver,
  appleResolver,
  spotifyResolver,
  rssResolver,
  directResolver,
  genericResolver, // fallback — always true
];

/** Find which resolver claims a URL (without doing I/O). */
export function pickResolver(url: string): Resolver {
  for (const r of RESOLVERS) {
    if (r.canHandle(url)) return r;
  }
  // genericResolver.canHandle is always true, so this is unreachable in practice.
  return genericResolver;
}

/**
 * Resolve a URL to a normalized ResolvedEpisode.
 * Throws ResolverError on classified failures (login/region/no_audio/spotify_exclusive).
 */
export async function resolveUrl(
  url: string,
  ctx: ResolveCtx = {},
): Promise<ResolvedEpisode> {
  const resolver = pickResolver(url);
  return resolver.resolve(url, ctx);
}

/** Platform label for a resolver name (for UI / logs). */
export function platformLabel(platform: SourcePlatform): string {
  switch (platform) {
    case 'xiaoyuzhou': return '小宇宙';
    case 'youtube': return 'YouTube';
    case 'bilibili': return 'B站';
    case 'apple_podcasts': return 'Apple Podcasts';
    case 'spotify': return 'Spotify';
    case 'rss': return 'RSS';
    case 'direct': return '音频直链';
    case 'generic': return '通用';
  }
}

export { ResolverError } from './types';
export type { Resolver, ResolvedEpisode, ResolveCtx, SourcePlatform, ResolverErrorKind } from './types';
export { buildEpisodeKey, parseEpisodeKey, contentHashPlatformId, fnv1aHash } from './episode-key';
export { parseRssXml, parseRssFeed } from './rss-parser';
export { isRssFeed } from './rss';
