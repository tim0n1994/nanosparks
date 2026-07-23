// POST /api/conversations/:id/reprocess
//
// Full-pipeline retry for a failed or stale conversation: resets status,
// clears any partial turns/participants, and re-enqueues the transcribe job
// (which chains into analyze automatically). Use this when transcription
// itself failed — /reextract only re-runs analysis and is useless without turns.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { transcribeQueue } from '@/lib/queue/config';
import { logger } from '@/lib/logger';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, episodeKey: true },
    });
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 },
      );
    }

    // Wipe partial output so the re-run is clean and counts restart from zero.
    await prisma.turn.deleteMany({ where: { conversationId } });
    await prisma.participant.deleteMany({ where: { conversationId } });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'pending' },
    });

    // Re-enqueue transcribe. The transcribe job's findAudioPath resolves the
    // audio file from mediaAssets or /tmp/nanosparks-audio/<pid>.mp3; if the
    // audio was evicted the job will fail fast with a clear error.
    const job = await transcribeQueue.add('transcribe', { conversationId });

    logger.info('Reprocess enqueued', { conversationId, jobId: job.id });
    return NextResponse.json({ success: true, data: { jobId: job.id } });
  } catch (error) {
    logger.error('Reprocess failed', { error: String(error) });
    return NextResponse.json(
      { success: false, error: 'Failed to reprocess conversation' },
      { status: 500 },
    );
  }
}
