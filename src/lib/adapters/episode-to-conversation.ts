/**
 * Episode → Conversation Adapter
 *
 * Maps existing Episode records into the new domain models (Source, Conversation, etc.)
 * Idempotent: safe to run multiple times.
 *
 * Phase 0 use:
 * - Backfill existing COMPLETED episodes into new models
 * - Called from ingest pipeline for new episodes
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface EpisodeMapping {
  sourceId: string;
  conversationId: string;
  corpusId: string;
  workspaceId: string;
}

/**
 * Update Conversation status by episodeId.
 * Shared utility used by transcribe and analyze jobs.
 */
export async function updateConversationStatus(episodeId: string, status: string): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { episodeId },
  });
  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status },
    });
  }
}

/**
 * Find episode IDs that do not yet have a Source mapping.
 * Uses raw query because Prisma doesn't generate reverse relation filter for new models.
 */
export async function findUnmappedEpisodeIds(): Promise<string[]> {
  const mappedIds = await prisma.source.findMany({
    where: { episodeId: { not: null } },
    select: { episodeId: true },
  });
  const mappedEpisodeIds = new Set(mappedIds.map(s => s.episodeId).filter(Boolean) as string[]);
  
  const allEpisodes = await prisma.episode.findMany({
    select: { id: true },
  });
  
  return allEpisodes
    .map(e => e.id)
    .filter(id => !mappedEpisodeIds.has(id));
}

/**
 * Ensure a default Workspace exists for the current user/demo context.
 * Creates one if none exists.
 */
export async function ensureDefaultWorkspace(): Promise<{ id: string }> {
  let workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { name: 'Default Workspace' },
    });
    logger.info(`Created default workspace: ${workspace.id}`);
  }

  return { id: workspace.id };
}

/**
 * Ensure a Corpus exists for YouTube imports.
 * Creates one if none exists for the given workspace.
 */
export async function ensureYouTubeCorpus(workspaceId: string): Promise<{ id: string }> {
  let corpus = await prisma.corpus.findFirst({
    where: { name: 'YouTube Imports', workspaceId },
  });

  if (!corpus) {
    corpus = await prisma.corpus.create({
      data: {
        name: 'YouTube Imports',
        description: 'Auto-imported YouTube videos',
        workspaceId,
      },
    });
    logger.info(`Created YouTube corpus: ${corpus.id}`);
  }

  return { id: corpus.id };
}

/**
 * Create Source and Conversation for an Episode.
 * Idempotent: skips if Source with this episodeId already exists.
 */
export async function createFromEpisode(episodeId: string): Promise<EpisodeMapping | null> {
  // Check if already mapped
  const existingSource = await prisma.source.findUnique({
    where: { episodeId },
  });
  if (existingSource) {
    const conversation = await prisma.conversation.findFirst({
      where: { episodeId },
    });
    return {
      sourceId: existingSource.id,
      conversationId: conversation?.id ?? '',
      corpusId: existingSource.corpusId,
      workspaceId: '',
    };
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: { analysis: true, channel: true },
  });

  if (!episode) {
    logger.warn(`Episode not found for mapping: ${episodeId}`);
    return null;
  }

  const workspace = await ensureDefaultWorkspace();
  const corpus = await ensureYouTubeCorpus(workspace.id);

  // Create Source
  const source = await prisma.source.create({
    data: {
      kind: 'youtube_url',
      uri: `https://www.youtube.com/watch?v=${episode.youtubeId}`,
      sourceType: 'youtube',
      episodeId: episode.id,
      corpusId: corpus.id,
      consentStatus: episode.channel ? 'public' : 'unknown',
      visibility: 'workspace',
      retentionPolicy: 'keep',
      status: episode.status === 'COMPLETED' ? 'completed' : episode.status.toLowerCase(),
    },
  });

  // Determine conversation status
  const conversationStatus = episode.status === 'COMPLETED' ? 'completed' 
    : episode.status === 'FAILED' ? 'failed' 
    : 'processing';

  // Create Conversation
  const conversation = await prisma.conversation.create({
    data: {
      title: episode.title,
      sourceId: source.id,
      corpusId: corpus.id,
      episodeId: episode.id,
      status: conversationStatus,
    },
  });

  // Map transcript segments to Turns
  if (Array.isArray(episode.transcript)) {
    const transcript = episode.transcript as Array<{
      start: number;
      end: number;
      text: string;
      speakerId?: string;
    }>;

    await prisma.turn.createMany({
      data: transcript.map((seg, idx) => ({
        conversationId: conversation.id,
        startMs: Math.round(seg.start * 1000),
        endMs: Math.round(seg.end * 1000),
        text: seg.text,
        confidence: 1.0,
        turnIndex: idx,
      })),
    });
  }

  // Map analysis speakers to Participants
  if (episode.analysis?.speakers) {
    const speakers = episode.analysis.speakers as Array<{
      id: string;
      name: string;
      role?: string;
    }>;

    for (const speaker of speakers) {
      await prisma.participant.create({
        data: {
          conversationId: conversation.id,
          name: speaker.name,
          role: speaker.role ?? null,
          speakerLabel: speaker.id,
          isResolved: true,
          confidence: 1.0,
        },
      });
    }
  }

  logger.info(`Mapped episode ${episodeId} → source=${source.id} conversation=${conversation.id}`);

  return {
    sourceId: source.id,
    conversationId: conversation.id,
    corpusId: corpus.id,
    workspaceId: workspace.id,
  };
}

/**
 * Backfill all existing episodes that haven't been mapped yet.
 * Uses findUnmappedEpisodeIds instead of Prisma where filter because
 * the reverse relation (Episode.source) is not available through Prisma.
 */
export async function backfillAllEpisodes(): Promise<number> {
  const unmappedIds = await findUnmappedEpisodeIds();

  let count = 0;
  for (const episodeId of unmappedIds) {
    const result = await createFromEpisode(episodeId);
    if (result) count++;
  }

  logger.info(`Backfill complete: ${count}/${unmappedIds.length} episodes mapped`);
  return count;
}
