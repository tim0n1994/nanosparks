/**
 * Digest worker (C3) — PRD §C3 关注节目（RSS 轮询新集自动转写进缓存）.
 *
 * Polls the RSS feeds of followed shows (Follow targetType='source'), detects
 * episodes not yet in the global cache (by episodeKey), and enqueues them for
 * transcription so followers get fresh episodes auto-added to their library.
 *
 * The worker is idempotent: an episode already present as a GlobalEpisode is
 * skipped. New episodes enter the shared cache and are linked to every follower.
 *
 * Run via a repeatable BullMQ job (cron) — see worker.ts registration.
 */

import { prisma } from '@/lib/prisma';
import { ingestQueue } from '@/lib/queue/config';
import { parseRssFeed } from '@/lib/resolvers/rss-parser';
import { buildEpisodeKey, type SourcePlatform, type ResolvedEpisode } from '@/lib/resolvers';
import { findOrLinkGlobalEpisode } from '@/lib/resolvers/cache';
import { logger } from '@/lib/logger';
import { deliverDigest, groupDigestsByRecipient, type DigestItem } from '@/lib/digest/delivery';

export interface DigestResult {
  sourcesPolled: number;
  newEpisodesEnqueued: number;
  skippedCached: number;
  errors: string[];
}
// Episodes collected this run, keyed by source id, for per-recipient delivery.
const collectedBySource = new Map<string, DigestItem[]>();

/**
 * System user id used by background workers (digest, retention) for shared-cache
 * ownership of auto-transcribed episodes. These episodes have no single human
 * owner; they are linked to every follower via the shared Conversation.
 */
const SYSTEM_USER_ID = 'system:digest';

/**
 * Poll all followed show sources for new episodes and enqueue uncached ones.
 * Safe to run repeatedly; cached episodes are skipped via episodeKey lookup.
 */
export async function processDigestJob(): Promise<DigestResult> {
  const result: DigestResult = { sourcesPolled: 0, newEpisodesEnqueued: 0, skippedCached: 0, errors: [] };

  // Distinct show-level sources that (a) have followers and (b) expose an RSS feedUrl.
  const followedSources = await prisma.source.findMany({
    where: {
      feedUrl: { not: null },
      // Has at least one follower (Follow.targetType='source', targetId=source.id)
    },
    select: { id: true, feedUrl: true, platform: true, uri: true },
  });

  // Filter to sources that actually have followers (cheaper than a join per source).
  const sourcesWithFollowers: typeof followedSources = [];
  for (const s of followedSources) {
    const followCount = await prisma.follow.count({
      where: { targetType: 'source', targetId: s.id },
    });
    if (followCount > 0) sourcesWithFollowers.push(s);
  }

  result.sourcesPolled = sourcesWithFollowers.length;

  for (const source of sourcesWithFollowers) {
    try {
      const feed = await parseRssFeed(source.feedUrl!);
      const platform = (source.platform ?? 'rss') as SourcePlatform;

      for (const ep of feed.episodes) {
        const episodeKey = buildEpisodeKey(platform, ep.guid || ep.enclosureUrl);
        const existing = await prisma.globalEpisode.findUnique({
          where: { episodeKey },
          select: { id: true },
        });
        if (existing) {
          result.skippedCached++;
          continue;
        }

        // Build a ResolvedEpisode and link it into the shared cache (same flow as
        // the ingest route), then enqueue the resolver ingest job with the real
        // conversationId so it can download + transcribe.
        const resolved: ResolvedEpisode = {
          platform,
          platformId: ep.guid || ep.enclosureUrl,
          episodeKey,
          title: ep.title,
          description: ep.description,
          audioUrl: ep.enclosureUrl,
          durationSec: ep.durationSec,
          coverUrl: feed.image,
          showTitle: feed.title,
          sourceUrl: source.uri ?? source.feedUrl!,
        };
        const { conversationId, cached } = await findOrLinkGlobalEpisode(resolved, SYSTEM_USER_ID);
        if (cached) {
          result.skippedCached++;
          continue;
        }
        await ingestQueue.add('ingest', {
          conversationId,
          episodeKey,
          audioUrl: ep.enclosureUrl,
          sourceUrl: resolved.sourceUrl,
          platform,
          title: ep.title,
          mode: 'robot',
        });
        result.newEpisodesEnqueued++;
        // Track for per-recipient digest delivery (PRD §C3).
        const siteBase = process.env.NEXT_PUBLIC_SITE_URL || 'https://nanosparks.example';
        const bucket = collectedBySource.get(source.id) ?? [];
        bucket.push({
          episodeTitle: ep.title,
          showTitle: feed.title,
          coverUrl: feed.image,
          readUrl: `${siteBase.replace(/\/+$/, '')}/read/${conversationId}`,
        });
        collectedBySource.set(source.id, bucket);
      }

      // Mark the show's feed as polled (used for metrics + scheduling visibility).
      await prisma.globalEpisode.updateMany({
        where: { platform, showTitle: feed.title },
        data: { lastPolledAt: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`${source.id}: ${msg}`);
    logger.warn('digest poll failed for source', { sourceId: source.id, error: msg });
    }
  }

  // ── PRD §C3: deliver digests to followers (email + WeChat template) ──
  try {
    // Collect all source-follows for sources that produced new episodes this run.
    const targetIds = Array.from(collectedBySource.keys());
    if (targetIds.length > 0) {
      const follows = await prisma.follow.findMany({
        where: { targetType: 'source', targetId: { in: targetIds } },
        select: { userId: true, targetType: true, targetId: true },
      });
      const byUser = groupDigestsByRecipient(follows, collectedBySource);
      // Recipients: we don't yet store email/openId on the user record, so delivery
      // is best-effort (LOGGING backend) until the user profile is wired. This keeps
      // the delivery path exercised end-to-end without blocking on profile work.
      const { LOGGING_EMAIL_BACKEND } = await import('@/lib/digest/delivery');
      for (const [userId, userItems] of byUser) {
        await deliverDigest({ userId }, userItems, LOGGING_EMAIL_BACKEND);
      }
      logger.info('digest delivery complete', { recipients: byUser.size });
    }
  } catch (err) {
    logger.warn('digest delivery failed', { error: String(err) });
  }
  collectedBySource.clear();

  logger.info('digest job complete', {
    sourcesPolled: result.sourcesPolled,
    newEpisodes: result.newEpisodesEnqueued,
    skippedCached: result.skippedCached,
    errors: result.errors.length,
  });

  return result;
}
