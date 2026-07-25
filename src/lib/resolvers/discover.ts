/**
 * Agentic podcast discovery — finds an RSS feed for a show that the
 * platform-specific resolvers couldn't resolve directly (e.g. Spotify exclusives,
 * shows whose oEmbed title doesn't match iTunes verbatim).
 *
 * Pipeline (cheap → expensive, stops at first hit):
 *   1. iTunes Search by title (free, no key) — most shows are listed here.
 *   2. If multiple candidates, an LLM picks the one most likely to be the same
 *      show (judges on name similarity + author/artist context), avoiding wrong
 *      merges between same-named-but-different shows.
 *   3. (future) Listen Notes / Podcast Index API for shows absent from iTunes.
 *
 * Returns the resolved RSS feedUrl + Apple collection id, or null when nothing
 * confident is found. The caller (agent resolver) decides whether to then
 * resolve that feed as a multi-episode list.
 */

import type { OpenAIClient } from '@/lib/llm/client';
import { z } from 'zod';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';

export interface PodcastCandidate {
  collectionId: number;
  collectionName: string;
  artistName: string;
  feedUrl: string | null;
  artworkUrl600: string | null;
  trackCount: number;
}

export interface DiscoveredFeed {
  feedUrl: string;
  collectionName: string;
  artworkUrl600: string | null;
  appleCollectionId: number;
  matchMethod: 'exact' | 'llm' | 'first_with_feed';
}

/**
 * iTunes Search for podcasts matching a title. Free, no key. Returns up to
 * `limit` candidates (those with a feedUrl are the only useful ones).
 */
export async function searchItunesPodcasts(
  title: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<PodcastCandidate[]> {
  const limit = opts.limit ?? 8;
  const u = new URL(ITUNES_SEARCH);
  u.searchParams.set('media', 'podcast');
  u.searchParams.set('entity', 'podcast');
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('term', title);
  let resp: Response;
  try {
    resp = await fetch(u.toString(), {
      signal: opts.signal,
      headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)' },
    });
  } catch {
    return [];
  }
  if (!resp.ok) return [];
  const data = (await resp.json()) as { resultCount: number; results: Array<Record<string, unknown>> };
  return (data.results ?? []).map((r) => ({
    collectionId: Number(r.collectionId ?? r.trackId ?? 0),
    collectionName: String(r.collectionName ?? r.trackName ?? ''),
    artistName: String(r.artistName ?? ''),
    feedUrl: r.feedUrl ? String(r.feedUrl) : null,
    artworkUrl600: r.artworkUrl600 ? String(r.artworkUrl600) : null,
    trackCount: Number(r.trackCount ?? 0),
  }));
}

/** Normalize a name for exact-ish comparison (lowercase, strip punctuation/ws). */
export function normalizeName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/podcast$/g, '') // many shows append "podcast" inconsistently
    .trim();
}

/**
 * Pure: pick the best candidate by exact-name match first, then by having a
 * feed. Returns the match + the method used, or null.
 */
export function pickBestCandidate(
  title: string,
  candidates: PodcastCandidate[],
): { candidate: PodcastCandidate; method: 'exact' | 'first_with_feed' } | null {
  if (candidates.length === 0) return null;
  const want = normalizeName(title);
  // Exact normalized-name hit with a feed wins.
  const exact = candidates.find((c) => c.feedUrl && normalizeName(c.collectionName) === want);
  if (exact) return { candidate: exact, method: 'exact' };
  // Otherwise the first candidate that actually has a feed.
  const withFeed = candidates.find((c) => c.feedUrl);
  if (withFeed) return { candidate: withFeed, method: 'first_with_feed' };
  return null;
}

const matchSchema = z.object({
  bestIndex: z.number().int().min(-1),
  reason: z.string().default(''),
});

/**
 * LLM arbitration: given the original title (possibly + author hint from the
 * source platform) and a list of iTunes candidates, ask a cheap model which
 * candidate is most likely the same show. Returns the chosen candidate or null.
 *
 * -1 means "none of these is confidently the same show" → no wrong merge.
 * Best-effort: on any LLM error, falls back to pickBestCandidate's heuristic.
 */
export async function llmPickCandidate(
  client: OpenAIClient,
  sourceTitle: string,
  sourceAuthor: string | null,
  candidates: PodcastCandidate[],
): Promise<{ candidate: PodcastCandidate | null; reason: string }> {
  const withFeed = candidates.filter((c) => c.feedUrl);
  if (withFeed.length === 0) return { candidate: null, reason: 'no candidates with a feed' };
  if (withFeed.length === 1) return { candidate: withFeed[0], reason: 'only one candidate' };

  const payload = withFeed.map((c, i) => ({
    index: i,
    name: c.collectionName,
    author: c.artistName,
    trackCount: c.trackCount,
  }));
  const prompt =
    `用户在一个播客平台看到了一个节目，想知道下面 iTunes 候选列表里哪一个最可能是同一个节目。` +
    `只有当你相当确信是同一档节目时才选（名字高度匹配 + 作者/主题吻合）；不确定就返回 -1（宁可放弃也不要错误匹配）。\n\n` +
    `源节目标题：${sourceTitle}\n` +
    (sourceAuthor ? `源节目作者/频道：${sourceAuthor}\n` : '') +
    `\niTunes 候选（JSON）：\n${JSON.stringify(payload)}\n\n` +
    `输出 JSON：{ "bestIndex": <0-based 索引 或 -1>, "reason": "<一句话理由>" }`;

  try {
    const result = await client.completeStructured(
      [{ role: 'user', content: prompt }],
      matchSchema,
      { maxTokens: 256, schemaName: 'podcast_match' },
    );
    if (result.bestIndex === -1) return { candidate: null, reason: result.reason || 'llm: no confident match' };
    const chosen = withFeed[result.bestIndex];
    if (!chosen) return { candidate: null, reason: 'llm: index out of range' };
    return { candidate: chosen, reason: result.reason };
  } catch {
    const fb = pickBestCandidate(sourceTitle, withFeed);
    return fb ? { candidate: fb.candidate, reason: `fallback:${fb.method}` } : { candidate: null, reason: 'fallback: none' };
  }
}

/**
 * Full discovery: search iTunes, then pick the best candidate (exact → LLM →
 * first-with-feed). Returns the resolved feed + provenance, or null.
 */
export async function discoverFeed(
  title: string,
  opts: { client?: OpenAIClient; author?: string | null; signal?: AbortSignal } = {},
): Promise<DiscoveredFeed | null> {
  const candidates = await searchItunesPodcasts(title, { signal: opts.signal });
  if (candidates.length === 0) return null;

  // 1. Exact match (no LLM cost).
  const exact = pickBestCandidate(title, candidates);
  if (exact?.candidate.feedUrl && exact.method === 'exact') {
    return toDiscovered(exact.candidate, 'exact');
  }

  // 2. LLM arbitration when several candidates exist and none is an exact hit.
  if (opts.client) {
    const llm = await llmPickCandidate(opts.client, title, opts.author ?? null, candidates);
    if (llm.candidate?.feedUrl) return toDiscovered(llm.candidate, 'llm');
  }

  // 3. Last resort: first candidate with a feed (lowest confidence).
  if (exact?.candidate.feedUrl) return toDiscovered(exact.candidate, 'first_with_feed');
  return null;
}

function toDiscovered(c: PodcastCandidate, method: DiscoveredFeed['matchMethod']): DiscoveredFeed {
  return {
    feedUrl: c.feedUrl!,
    collectionName: c.collectionName,
    artworkUrl600: c.artworkUrl600,
    appleCollectionId: c.collectionId,
    matchMethod: method,
  };
}
