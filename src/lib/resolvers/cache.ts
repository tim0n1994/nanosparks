/**
 * Global Transcription Cache (A1) — the cost + social-density compound engine.
 *
 * Before enqueuing the pipeline, the ingest flow calls findOrLinkGlobalEpisode().
 * On a cache hit, the user's corpus references the existing shared Conversation and
 * the pipeline is skipped entirely (秒开 + 成本≈¥0). On a miss, we create the
 * GlobalEpisode + canonical shared Conversation and return cached:false so the
 * caller enqueues the FlowProducer pipeline.
 *
 * Privacy invariant (PRD §A1): uploads NEVER touch the shared cache. A direct call
 * with isUpload:true creates a private Conversation and returns cached:false,
 * regardless of content hash. Only public-source content (resolver-resolved) is cached.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { ResolvedEpisode } from './types';
import { ensureUserCorpus } from './user-corpus';

export interface CacheLinkResult {
  conversationId: string;
  /** True = pipeline should be skipped (shared conversation already built). */
  cached: boolean;
  /** True when a brand-new GlobalEpisode was created this call. */
  created: boolean;
}

/**
 * Look up or create the canonical shared Conversation for a resolved public episode.
 * If a GlobalEpisode already exists for this episodeKey, link the user to it and
 * skip the pipeline. Otherwise create the GlobalEpisode + Conversation shell.
 *
 * @param resolved normalized episode from the resolver chain
 * @param userId   the Clerk userId of the submitting user
 * @param opts.isUpload when true, bypass the cache entirely (privacy boundary)
 */
export async function findOrLinkGlobalEpisode(
  resolved: ResolvedEpisode,
  userId: string,
  opts: { isUpload?: boolean } = {},
): Promise<CacheLinkResult> {
  const { corpusId } = await ensureUserCorpus(userId);

  // Uploads are always private — never read from or write to the shared cache.
  if (opts.isUpload) {
    const conversation = await prisma.conversation.create({
      data: {
        title: resolved.title,
        corpusId,
        episodeKey: null, // no global key for uploads
        isSharedCache: false,
        status: 'pending',
      },
    });
    logger.info(`Upload → private conversation (no cache)`, { conversationId: conversation.id, userId });
    return { conversationId: conversation.id, cached: false, created: true };
  }

  // Cache hit: an existing GlobalEpisode owns this episodeKey.
  const existing = await prisma.globalEpisode.findUnique({
    where: { episodeKey: resolved.episodeKey },
    include: { conversation: { select: { id: true, status: true } } },
  });

  if (existing) {
    // Link this user's corpus to the shared conversation (idempotent: we don't
    // duplicate turns — the shared Conversation is referenced read-only).
    await ensureSourceLink({
      corpusId,
      resolved,
      conversationId: existing.conversationId,
      userId,
    });
    await prisma.globalEpisode.update({
      where: { id: existing.id },
      data: {
        readCount: { increment: 1 },
        // Backfill the audio enclosure if the first create didn't have it.
        ...(resolved.audioUrl && !existing.audioUrl ? { audioUrl: resolved.audioUrl } : {}),
        // Backfill description for fact-correction context if missing.
        ...(resolved.description && !existing.description ? { description: resolved.description } : {}),
      },
    });
    const isReady = existing.conversation.status === 'completed' || existing.conversation.status === 'transcribed';
    logger.info(`Cache hit`, {
      episodeKey: resolved.episodeKey,
      conversationId: existing.conversationId,
      ready: isReady,
      userId,
    });
    return {
      conversationId: existing.conversationId,
      cached: true,
      created: false,
    };
  }

  // Cache miss: create the shared canonical Conversation + GlobalEpisode record.
  const conversation = await prisma.conversation.create({
    data: {
      title: resolved.title,
      corpusId,
      episodeKey: resolved.episodeKey,
      language: undefined,
      isSharedCache: true,
      status: 'pending',
    },
  });

  await prisma.globalEpisode.create({
    data: {
      episodeKey: resolved.episodeKey,
      platform: resolved.platform,
      platformId: resolved.platformId,
      conversationId: conversation.id,
      title: resolved.title,
      showTitle: resolved.showTitle,
      description: resolved.description,
      coverUrl: resolved.coverUrl,
      durationSec: resolved.durationSec,
      sourceUrl: resolved.sourceUrl,
      audioUrl: resolved.audioUrl,
      readCount: 1,
    },
});

 // corpus.id → corpusId (per-user corpus handle from ensureUserCorpus)
 await ensureSourceLink({ corpusId, resolved, conversationId: conversation.id, userId });

  logger.info(`Cache miss → created shared conversation`, {
    episodeKey: resolved.episodeKey,
    conversationId: conversation.id,
    userId,
  });

  return { conversationId: conversation.id, cached: false, created: true };
}

/** Idempotently create a Source linking the user's corpus to the shared conversation. */
async function ensureSourceLink(args: {
  corpusId: string;
  resolved: ResolvedEpisode;
  conversationId: string;
  userId: string;
}): Promise<void> {
  const { corpusId, resolved, conversationId } = args;
  const existing = await prisma.source.findFirst({
    where: { corpusId, uri: resolved.sourceUrl },
  });
  if (existing) {
    // Ensure the source points at the shared conversation if it doesn't already.
    const hasConv = await prisma.conversation.findFirst({
      where: { sourceId: existing.id, id: conversationId },
      select: { id: true },
    });
    if (!hasConv) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { sourceId: existing.id },
      });
    }
    return;
  }
 const source = await prisma.source.create({
   data: {
     kind: resolved.platform === 'direct' ? 'media_upload' : 'youtube_url',
     uri: resolved.sourceUrl,
     platform: resolved.platform,
     corpusId,
     consentStatus: 'public',
     visibility: 'private', // the user's own access; shared layer is governed by isSharedCache
     status: 'pending',
   },
 });
  // For show-level sources (rss/apple_podcasts), persist the feedUrl so the C3
  // digest worker can poll for new episodes on behalf of followers.
  const isFeedShow =
    (resolved.platform === 'rss' || resolved.platform === 'apple_podcasts') &&
    !!resolved.isMultiEpisode;
  if (isFeedShow) {
    await prisma.source.update({
      where: { id: source.id },
      data: { feedUrl: resolved.sourceUrl },
    });
  }
 await prisma.conversation.update({
    where: { id: conversationId },
    data: { sourceId: source.id },
  });
}
