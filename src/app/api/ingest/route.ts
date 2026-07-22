import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import { addIngestJob } from '@/lib/queue/config';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { resolveUrl, ResolverError } from '@/lib/resolvers';
import { findOrLinkGlobalEpisode } from '@/lib/resolvers/cache';
import { checkIngestGuardrails, loadGuardrailConfig } from '@/lib/guardrails';
import { getMonthlyQuotaStatus } from '@/lib/quota';
import { getUserTier, isPro } from '@/lib/billing/tier';
import { monthlyQuotaFor } from '@/lib/billing/tier';

const ingestSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['robot', 'creator', 'ugc']),
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
    const { url, mode } = ingestSchema.parse(body);

    // Resolve via the unified chain, then consult the global cache.
    return await handleResolvedUrl(url, mode, userId);
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Resolve a submitted URL and route it through the global cache (A1).
 * Multi-episode (podcast show / RSS feed / Spotify hint) → return a list for selection.
 * Single episode → cache hit skips the pipeline (秒开); miss enqueues FlowProducer.
 */
async function handleResolvedUrl(url: string, mode: string, userId: string) {
  let resolved;
  try {
    resolved = await resolveUrl(url, readResolverCookies());
  } catch (err) {
    return handleError(err);
  }

  // Guardrails: reject before any cost is incurred.
  // PRD §A4: load runtime-tunable guardrail config (Setting overrides) before checking.
  const guardrailCfg = await loadGuardrailConfig();
  const guard = await checkIngestGuardrails(userId, { durationSec: resolved.durationSec }, guardrailCfg);
  if (!guard.ok) {
    return NextResponse.json(
      { success: false, error: guard.message, kind: guard.reason, conversationId: guard.conversationId },
      { status: 429 },
    );
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
        durationSec: e.durationSec,
        coverUrl: e.coverUrl,
        audioUrl: e.audioUrl,
      })),
    });
  }

  const { conversationId, cached } = await findOrLinkGlobalEpisode(resolved, userId);

  // PRD §A4/§7: Pro users get queue priority + higher quota. Resolve tier early.
  const tier = await getUserTier(userId);

  // Quota (PRD §7): cache hits are unlimited reads; only first-time
  // transcriptions consume the free monthly quota.
  if (!cached) {
    // PRD §7: Pro users get 60 集/月 vs Free 4 集/月.
    const quota = await getMonthlyQuotaStatus(userId, {
      freeMonthlyFirstTranscriptions: monthlyQuotaFor(tier),
    });
    if (!quota.canTranscribe) {
      return NextResponse.json(
        {
          success: false,
          error: `本月首转额度已用完（${quota.used}/${quota.limit}）。缓存命中的集仍可无限读，或升级 Pro。`,
          kind: 'quota_exhausted',
          quota,
        },
        { status: 429 },
      );
    }
  }

  if (cached) {
    logger.info(`Ingest cache hit — skipping pipeline`, { conversationId, episodeKey: resolved.episodeKey });
    return NextResponse.json({
      success: true,
      conversationId,
      cached: true,
      title: resolved.title,
    });
  }

  // PRD §A4/§7: Pro users get queue priority + higher quota.
  await addIngestJob({
    conversationId,
    episodeKey: resolved.episodeKey,
    audioUrl: resolved.audioUrl,
    sourceUrl: resolved.sourceUrl,
    platform: resolved.platform,
    title: resolved.title,
    mode,
  }, { pro: isPro(tier) });

  return NextResponse.json({
    success: true,
    conversationId,
    cached: false,
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
