/**
 * Per-user Workspace + Corpus bootstrap (A1).
 *
 * Each user gets their own Workspace and a "My Library" Corpus so their reading
 * progress, highlights, and private uploads stay isolated, even when they are
 * reading from the shared transcription cache. The shared Conversation is linked
 * into the user's corpus via a Source row (see cache.ts).
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface UserCorpus {
  workspaceId: string;
  corpusId: string;
}

/**
 * Ensure a workspace + "My Library" corpus exist for the given Clerk userId.
 * Idempotent: reuses the existing workspace/corpus on subsequent calls.
 */
export async function ensureUserCorpus(userId: string): Promise<UserCorpus> {
  let workspace = await prisma.workspace.findUnique({ where: { clerkId: userId } });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { name: `User ${userId.slice(0, 8)}`, clerkId: userId },
    });
    logger.info(`Created workspace for user`, { userId, workspaceId: workspace.id });
  }

  const corpusName = 'My Library';
  let corpus = await prisma.corpus.findFirst({
    where: { workspaceId: workspace.id, name: corpusName },
  });
  if (!corpus) {
    corpus = await prisma.corpus.create({
      data: {
        name: corpusName,
        description: 'Your personal reading library',
        workspaceId: workspace.id,
      },
    });
  }

  return { workspaceId: workspace.id, corpusId: corpus.id };
}
