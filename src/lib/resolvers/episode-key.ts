/**
 * episodeKey computation (A1).
 *
 * The cache key is `${platform}:${platformId}`. Sources with a stable native id
 * (xiaoyuzhou eid, youtube video id, apple guid, rss guid) use it directly.
 * Sources without a native id (direct mp3 link, generic yt-dlp hit) fall back to a
 * content-hash of the first bytes of the audio so the same file still dedupes.
 */

import type { SourcePlatform } from './types';

/** Build a canonical episodeKey from platform + platformId. */
export function buildEpisodeKey(platform: SourcePlatform, platformId: string): string {
  return `${platform}:${platformId}`;
}

/** Cheap, stable hash (FNV-1a 32-bit) of arbitrary string input. */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime (multiply with overflow wrapping to 32-bit)
    hash = Math.imul(hash, 0x01000193);
  }
  // unsigned 32-bit, base36, zero-padded to 8 chars for key stability
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/**
 * Content-hash fallback platformId for sources with no native id.
 * Combines the canonical audio URL + size + first-bytes digest when available.
 */
export function contentHashPlatformId(parts: {
  url: string;
  size?: number;
  head?: string;
}): string {
  const raw = `${parts.url}|${parts.size ?? 0}|${parts.head ?? ''}`;
  return `ch_${fnv1aHash(raw)}`;
}

/** Split an episodeKey back into [platform, platformId]. */
export function parseEpisodeKey(key: string): { platform: SourcePlatform; platformId: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  return { platform: key.slice(0, idx) as SourcePlatform, platformId: key.slice(idx + 1) };
}
