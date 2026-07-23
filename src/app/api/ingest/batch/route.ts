/**
 * POST /api/ingest/batch — Batch ingest selected episodes from a show/feed.
 *
 * The client already holds the episode list from the prior multi-episode
 * resolve (POST /api/ingest → multiEpisode:true). It sends the user's selected
 * episodes here; we dedupe via findOrLinkGlobalEpisode, enforce monthly quota
 * (Free 4 / Pro 60), and enqueue uncached episodes within quota.
 *
 * Body: { url: string (源链接，仅日志/归属), episodes: BatchEpisodeInput[], mode?: 'robot' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { rateLimit } from '@/lib/rate-limit';
import { batchIngestEpisodes } from '@/lib/queue/batch';
import { logger } from '@/lib/logger';

const episodeSchema = z.object({
  episodeKey: z.string().min(1),
  audioUrl: z.string().min(1),
  sourceUrl: z.string(),
  platform: z.string(),
  title: z.string(),
  durationSec: z.number().optional(),
});

const bodySchema = z.object({
  url: z.string(), // source feed/show URL (logging + attribution only)
  episodes: z.array(episodeSchema).min(1).max(50),
  mode: z.enum(['robot', 'creator', 'ugc']).default('robot'),
});

export async function POST(request: NextRequest) {
  try {
    // Auth — skip when Clerk not configured (dev).
    let userId = 'dev-user';
    if (isValidClerkKey) {
      const { userId: clerkUserId } = await auth();
      if (!clerkUserId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      userId = clerkUserId;
    }

    // Rate limit (batch is a heavier action).
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
    const rateResult = await rateLimit(ip, 'ingest');
    if (!rateResult.success) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
    }

    const { url, episodes, mode } = parsed.data;

    logger.info('batch ingest requested', { userId, sourceUrl: url, episodeCount: episodes.length });

    const result = await batchIngestEpisodes({ userId, episodes, mode });

    return NextResponse.json({
      success: true,
      enqueued: result.enqueued,
      skippedCached: result.cachedResults.length,
      skippedQuota: result.skippedQuota,
      quotaUsed: result.quotaUsed,
      quotaLimit: result.quotaLimit,
    });
  } catch (err) {
    logger.error('batch ingest failed', { error: String(err) });
    return NextResponse.json({ success: false, error: 'Batch ingest failed' }, { status: 500 });
  }
}
