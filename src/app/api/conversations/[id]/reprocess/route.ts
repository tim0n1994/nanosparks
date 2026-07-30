// POST /api/conversations/:id/reprocess
//
// Full-pipeline retry for a failed or stale conversation. Checks if audio exists
// locally — if not, re-enqueues the ingest job (download → transcribe → analyze)
// instead of jumping straight to transcribe (which would fail with "No audio file").
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { transcribeQueue, ingestQueue } from '@/lib/queue/config';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        episodeKey: true,
        source: {
          select: {
            mediaAssets: { select: { storageKey: true, filePath: true } },
            uri: true,
            platform: true,
          },
        },
        globalEpisode: { select: { audioUrl: true, platformId: true } },
      },
    });
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 },
      );
    }

    // Wipe partial output so the re-run is clean.
    await prisma.turn.deleteMany({ where: { conversationId } });
    await prisma.participant.deleteMany({ where: { conversationId } });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'pending' },
    });

    // Check if audio file exists locally.
    const audioPath = conversation.source?.mediaAssets?.[0]?.filePath;
    const pid = conversation.globalEpisode?.platformId || conversation.episodeKey?.split(':')[1];
    const tmpPath = pid ? `/tmp/nanosparks-audio/${pid}.mp3` : null;
    const hasAudio = (audioPath && existsSync(audioPath)) || (tmpPath && existsSync(tmpPath));

    if (hasAudio) {
      // Audio exists → jump to transcribe (fast path).
      const job = await transcribeQueue.add('transcribe', { conversationId });
      logger.info('Reprocess → transcribe (audio exists)', { conversationId, jobId: job.id });
    } else {
      // No audio → re-enqueue full ingest (download → transcribe → analyze).
      // This is the fix for episodes created via batch ingest where the
      // download job failed (e.g. worker Redis disconnect) but the
      // Conversation record was already created.
      const audioUrl = conversation.globalEpisode?.audioUrl;
      if (!audioUrl) {
        return NextResponse.json(
          { success: false, error: 'No audio URL found — cannot re-download. Re-submit the episode link instead.' },
          { status: 400 },
        );
      }
      const job = await ingestQueue.add('ingest', {
        conversationId,
        episodeKey: conversation.episodeKey,
        audioUrl,
        sourceUrl: conversation.source?.uri ?? '',
        platform: conversation.source?.platform ?? 'direct',
        title: '',
        mode: 'robot',
      });
      logger.info('Reprocess → ingest (re-downloading audio)', { conversationId, jobId: job.id, audioUrl: audioUrl.slice(0, 60) });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Reprocess failed', { error: String(error) });
    return NextResponse.json(
      { success: false, error: 'Failed to reprocess conversation' },
      { status: 500 },
    );
  }
}
