/**
 * POST /api/episodes/summarize
 *
 * Agentic episode summary: when a user expands a non-Chinese episode row, this
 * fetches the episode's full shownotes (description + chapters) via yt-dlp and
 * summarizes them into structured Chinese (title + overview + per-topic bullets)
 * so the user can decide whether to download without reading foreign shownotes.
 *
 * Body (any of):
 *   { videoId: "abc1234567_" }            → yt-dlp deep fetch (richest)
 *   { url: "https://youtu.be/abc..." }    → extract videoId → yt-dlp
 *   { title, description? }               → summarize from what's given (fallback)
 *
 * Already-Chinese episodes return { skipped: true } without an LLM call.
 * Lazy (one call per expand), cheap model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { summarizeEpisode, isMostlyChinese } from '@/lib/resolvers/episode-summary';
import { getEpisodeMeta, extractVideoId } from '@/lib/youtube/episode-meta';

const bodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  videoId: z.string().optional(),
  url: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'title or videoId is required' }, { status: 400 });
    }
    const { title, description, videoId, url } = parsed.data;

    // Resolve a videoId from explicit id or URL.
    const vid = videoId ?? (url ? extractVideoId(url) : null);

    let epTitle = title ?? '';
    let epDesc = description ?? '';
    let epChapters: string[] = [];

    // Agentic deep fetch: when we have a YouTube videoId, pull full shownotes +
    // chapters via yt-dlp. This is what makes the summary actually useful —
    // flat-playlist only had a bare title.
    if (vid) {
      const meta = await getEpisodeMeta(vid);
      if (meta) {
        if (!epTitle) epTitle = meta.title;
        epDesc = epDesc || meta.description;
        epChapters = meta.chapters;
      }
    }

    if (!epTitle) {
      return NextResponse.json({ success: false, error: '无法获取该集信息' }, { status: 400 });
    }

    // Already Chinese → no translation needed.
    if (isMostlyChinese(`${epTitle}\n${epDesc}`)) {
      return NextResponse.json({ success: true, data: { skipped: true } });
    }

    const summary = await summarizeEpisode(epTitle, epDesc, epChapters);
    if (!summary) {
      return NextResponse.json({ success: true, data: { skipped: true } });
    }
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Summary failed: ${String(error)}` },
      { status: 500 },
    );
  }
}
