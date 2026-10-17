import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { transcribeQueue, ingestQueue } from '@/lib/queue/config';
import { access as fileAccess, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { logger } from '@/lib/logger';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { checkRetryBudget, claimRetry, enqueueRetry, releaseRetry, RETRYABLE_STATUSES, retryConflict, RetrySubmissionError } from '@/lib/queue/retry';
import { createStorageProvider } from '@/lib/storage/provider';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';
import { join } from 'node:path';

async function readableAudio(paths: (string | null | undefined)[]) {
  for (const path of paths) {
    if (!path) continue;
    try {
      const file = await stat(path);
      if (file.isFile() && file.size > 0) {
        await fileAccess(path, constants.R_OK);
        return path;
      }
    } catch { continue; }
  }
  return null;
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;
    const access = await requireConversationAccess(conversationId, 'write');
    if ('response' in access) return access.response;
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, title: true, status: true, updatedAt: true, episodeKey: true,
        source: { select: { mediaAssets: { select: { storageKey: true, filePath: true } }, uri: true, platform: true } },
        globalEpisode: { select: { audioUrl: true, platformId: true, sourceUrl: true, platform: true, durationSec: true } },
      },
    });
    if (!conversation) return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    if (!RETRYABLE_STATUSES.includes(conversation.status)) return retryConflict();

    const pid = conversation.globalEpisode?.platformId || conversation.episodeKey?.split(':').slice(1).join(':');
    const safePid = pid && /^[a-zA-Z0-9_-]+$/.test(pid) ? pid : null;
    const assets = conversation.source?.mediaAssets ?? [];
    const audioDirectory = getAudioOutputDir();
    const audioPath = await readableAudio([
      ...assets.map((asset) => asset.filePath),
      join(audioDirectory, `${conversationId}.mp3`),
      safePid ? join(audioDirectory, `${safePid}.mp3`) : null,
    ]);
    const platform = conversation.globalEpisode?.platform ?? conversation.source?.platform ?? 'direct';
    let mediaKey: string | undefined;
    if (!audioPath) {
      const storage = createStorageProvider();
      for (const asset of assets) {
        if (!asset.storageKey || asset.storageKey.includes('..') || asset.storageKey.startsWith('/')) continue;
        try {
          if ((await storage.get(asset.storageKey)).length > 0) {
            mediaKey = asset.storageKey;
            break;
          }
        } catch { continue; }
      }
    }
    const sourceUrl = httpUrl(conversation.globalEpisode?.sourceUrl) ?? httpUrl(conversation.source?.uri);
    const audioUrl = httpUrl(conversation.globalEpisode?.audioUrl)
      ?? (['youtube', 'bilibili', 'generic', 'direct'].includes(platform) ? sourceUrl : null);
    if (!audioPath && !mediaKey && !audioUrl) {
      return NextResponse.json({ success: false, error: 'No recoverable audio or source URL; submit the original media again.' }, { status: 400 });
    }
    const budget = await checkRetryBudget(access.userId, conversationId, conversation.globalEpisode?.durationSec ?? undefined);
    if (budget) return budget;
    const claimedAt = await claimRetry(conversation);
    if (!claimedAt) return retryConflict();
    try {
      const jobId = `retry-${conversationId}-${claimedAt.getTime()}`;
      if (audioPath || mediaKey) {
        await enqueueRetry(transcribeQueue, 'transcribe', { conversationId, ...(audioPath ? { audioPath } : { mediaKey }) }, jobId);
      } else {
        await enqueueRetry(ingestQueue, 'ingest', { conversationId, processingRunId: jobId, episodeKey: conversation.episodeKey, audioUrl, sourceUrl: sourceUrl ?? audioUrl, platform, title: conversation.title ?? '', mode: 'robot' }, jobId);
      }
    } catch (error) {
      if (!(error instanceof RetrySubmissionError) || error.confirmedAbsent) await releaseRetry(conversation, claimedAt);
      throw error;
    }
    return NextResponse.json({ success: true, status: 'pending' });
  } catch (error) {
    logger.error('Reprocess failed', { error: String(error) });
    if (error instanceof RetrySubmissionError && !error.confirmedAbsent) {
      return NextResponse.json({ success: false, kind: 'enqueue_uncertain', error: error.message }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: 'Failed to enqueue reprocessing; existing results were retained' }, { status: 503 });
  }
}
