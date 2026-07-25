/**
 * POST /api/discover/feed
 *
 * Agentic fallback: when a platform-specific link (Spotify etc.) can't be
 * fetched (network/DRM/exclusive), the user can type the *show name* and we
 * discover its RSS via iTunes + LLM arbitration, returning a multi-episode list.
 *
 * This bypasses the closed platform entirely — iTunes is reachable where
 * open.spotify.com is not, so this is the reliable path for Spotify shows.
 *
 * Body: { name: string, author?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { discoverFeed } from '@/lib/resolvers/discover';
import { parseRssFeed } from '@/lib/resolvers/rss-parser';
import { OpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { buildEpisodeKey } from '@/lib/resolvers/episode-key';

const bodySchema = z.object({
  name: z.string().min(1),
  author: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: '节目名不能为空' }, { status: 400 });
    }
    const { name, author } = parsed.data;

    // Build the agent LLM client (optional; discovery falls back to heuristic).
    let client: OpenAIClient | undefined;
    try {
      const s = await getLlmSettings();
      if (s.apiFormat !== 'anthropic') client = new OpenAIClient(s.apiKey, s.model, s.baseUrl);
    } catch { /* heuristic-only */ }

    const discovered = await discoverFeed(name, { client, author });
    if (!discovered) {
      return NextResponse.json({
        success: false,
        error: `在 iTunes 没找到「${name}」的 RSS 源。该节目可能是平台独占，或名字拼写不同。试试节目官网找 RSS。`,
        kind: 'no_feed',
      }, { status: 404 });
    }

    const feed = await parseRssFeed(discovered.feedUrl).catch(() => null);
    if (!feed || feed.episodes.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          feedUrl: discovered.feedUrl,
          showTitle: discovered.collectionName,
          matchMethod: discovered.matchMethod,
          episodes: [],
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        feedUrl: discovered.feedUrl,
        showTitle: feed.title || discovered.collectionName,
        coverUrl: feed.image ?? discovered.artworkUrl600 ?? null,
        matchMethod: discovered.matchMethod,
        episodes: feed.episodes.slice(0, 20).map((e) => ({
          episodeKey: buildEpisodeKey('rss', e.guid || e.enclosureUrl),
          platform: 'rss',
          title: e.title,
          description: e.description,
          audioUrl: e.enclosureUrl,
          durationSec: e.durationSec,
          coverUrl: feed.image ?? null,
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `发现失败: ${String(error)}` },
      { status: 500 },
    );
  }
}
