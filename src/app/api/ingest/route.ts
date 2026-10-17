import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { ingestQueue } from '@/lib/queue/config';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { resolveUrl, ResolverError } from '@/lib/resolvers';
import { findOrLinkGlobalEpisode } from '@/lib/resolvers/cache';
import { checkIngestGuardrails, loadGuardrailConfig } from '@/lib/guardrails';
import { getMonthlyQuotaStatus } from '@/lib/quota';
import { getUserTier } from '@/lib/billing/tier';
import { monthlyQuotaFor } from '@/lib/billing/tier';
import { prisma } from '@/lib/prisma';
import { enqueueRetry, RetrySubmissionError } from '@/lib/queue/retry';

const ingestSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['robot', 'creator', 'ugc']),
  asrProvider: z.enum(['qwen', 'deepgram', 'auto']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Authentication check — skip when Clerk is not configured (dev/E2E)
    let userId = 'dev-user';
    if (isValidClerkKey) {
      const { userId: clerkUserId } = await auth();
      if (!clerkUserId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      userId = clerkUserId;
    }

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
    const rateResult = await rateLimit(ip, 'ingest');
    if (!rateResult.success) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { url, mode, asrProvider } = ingestSchema.parse(body);

    // Resolve via the unified chain, then consult the global cache.
    return await handleResolvedUrl(url, mode, userId, asrProvider);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Resolve a submitted URL and route it through the global cache (A1).
 * Multi-episode (podcast show / RSS feed / Spotify hint) → return a list for selection.
 * Single episode → cache hit skips the pipeline (秒开); miss enqueues FlowProducer.
 */
async function handleResolvedUrl(url: string, mode: string, userId: string, asrProvider?: string) {
  let resolved;
  try {
    resolved = await resolveUrl(url, readResolverCookies());
  } catch (err) {
    return handleError(err);
  }

  if (resolved.isMultiEpisode && resolved.episodes && resolved.episodes.length > 0) {
    return NextResponse.json({
      success: true,
      multiEpisode: true,
      showTitle: resolved.showTitle,
      coverUrl: resolved.coverUrl,
      episodes: resolved.episodes.map((e) => ({
        episodeKey: e.episodeKey,
        platform: e.platform,
        title: e.title,
        description: e.description,
        durationSec: e.durationSec,
        coverUrl: e.coverUrl,
        audioUrl: e.audioUrl,
      })),
    });
  }

  const tier = await getUserTier(userId);
  const { conversationId, cached, created, state } = await findOrLinkGlobalEpisode(resolved, userId, { beforeCreate: async () => {
    const config = await loadGuardrailConfig();
    const guard = await checkIngestGuardrails(userId, { durationSec: resolved.durationSec }, config);
    if (!guard.ok) throw NextResponse.json({ success: false, error: guard.message, kind: guard.reason, conversationId: guard.conversationId }, { status: 429 });
    const quota = await getMonthlyQuotaStatus(userId, {
      freeMonthlyFirstTranscriptions: monthlyQuotaFor(tier),
    });
    if (!quota.canTranscribe) {
      throw NextResponse.json(
        {
          success: false,
          error: `本月首转额度已用完（${quota.used}/${quota.limit}）。缓存命中的集仍可无限读，或升级 Pro。`,
          kind: 'quota_exhausted',
          quota,
        },
        { status: 429 },
      );
    }
  } });

  if (!created && !cached) {
    if (state === 'failed') {
      return NextResponse.json({ success: false, conversationId, cached: false, state, kind: 'retry_required', error: 'Existing processing failed; retry from the conversation.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, conversationId, cached: false, state: 'inflight', title: resolved.title }, { status: 202 });
  }

  if (cached) {
    logger.info(`Ingest cache hit — skipping pipeline`, { conversationId, episodeKey: resolved.episodeKey });
    return NextResponse.json({
      success: true,
      conversationId,
      cached: true,
      state: 'ready',
      title: resolved.title,
    });
  }

  try {
    await enqueueRetry(ingestQueue, 'ingest', {
      conversationId,
      episodeKey: resolved.episodeKey,
      audioUrl: resolved.audioUrl,
      sourceUrl: resolved.sourceUrl,
      platform: resolved.platform,
      title: resolved.title,
      mode,
      asrProvider,
    }, `ingest-${conversationId}`);
  } catch (error) {
    if (error instanceof RetrySubmissionError && error.confirmedAbsent) {
      await prisma.conversation.updateMany({ where: { id: conversationId, status: 'pending' }, data: { status: 'failed' } });
    }
    throw error;
  }

  return NextResponse.json({
    success: true,
    conversationId,
    cached: false,
    state: 'inflight',
    title: resolved.title,
  });
}

/** Read a shared cookie header from env for sources requiring login (B站/YouTube age gate). */
function readResolverCookies(): { cookies?: string } {
  const cookies = process.env.RESOLVER_COOKIES;
  return cookies ? { cookies } : {};
}

/** Centralized error mapping so failures reach the user as human messages. */
function handleError(error: unknown): NextResponse {
  if (error instanceof NextResponse) return error;
  if (error instanceof RetrySubmissionError) {
    return NextResponse.json({ success: false, kind: error.confirmedAbsent ? 'enqueue_failed' : 'enqueue_uncertain', error: error.message }, { status: 503 });
  }
  if (error instanceof ResolverError) {
    const status =
      error.kind === 'not_found' ? 404 :
      error.kind === 'spotify_exclusive' ? 422 :
      error.kind === 'login_required' || error.kind === 'region_restricted' ? 403 :
      502;
    return NextResponse.json(
      { success: false, error: error.message, kind: error.kind, platform: error.platform },
      { status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ success: false, error: error.issues }, { status: 400 });
  }
  logger.error('Ingest resolve error', { error: String(error) });
  return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
}
