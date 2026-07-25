/**
 * POST /api/episodes/summarize
 *
 * Agentic episode picker helper: translates a non-Chinese episode's title +
 * description into a concise Chinese title + one-line summary, so users can
 * decide which episodes are worth downloading without reading foreign shownotes.
 *
 * Lazy (one call per expand), cheap model. Already-Chinese episodes return
 * { skipped: true } without an LLM call.
 *
 * Body: { title: string, description?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { summarizeEpisode, isMostlyChinese } from '@/lib/resolvers/episode-summary';

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }
    const { title, description } = parsed.data;

    // Already Chinese → no translation needed.
    if (isMostlyChinese(`${title}\n${description ?? ''}`)) {
      return NextResponse.json({ success: true, data: { skipped: true } });
    }

    const summary = await summarizeEpisode(title, description);
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
