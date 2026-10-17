/**
 * POST /api/conversations/:id/reextract
 *
 * Create a new ExtractionRun for this conversation.
 * Body: { model?, promptVersion? }
 *
 * The run starts in "pending" status. The actual extraction is performed
 * by the analyze job (which now creates ExtractionRun records).
 * Old runs are not deleted — they remain for A/B comparison.
 * The new run becomes active only after successful completion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLlmSettings } from '@/lib/settings';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { checkRetryBudget, claimRetry, enqueueRetry, releaseRetry, RETRYABLE_STATUSES, retryConflict, RetrySubmissionError } from '@/lib/queue/retry';

const reextractSchema = z.object({
  model: z.string().optional(),
  promptVersion: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;
    const access = await requireConversationAccess(conversationId, 'write');
    if ('response' in access) return access.response;
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = reextractSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues },
        { status: 400 },
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, corpusId: true, status: true, updatedAt: true, _count: { select: { turns: true } }, globalEpisode: { select: { durationSec: true } } },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 },
      );
    }

    if (!RETRYABLE_STATUSES.includes(conversation.status)) return retryConflict();
    if (conversation._count.turns === 0) {
      return NextResponse.json({ success: false, error: 'No transcript available to extract' }, { status: 400 });
    }
    const budget = await checkRetryBudget(access.userId, conversationId, conversation.globalEpisode?.durationSec ?? undefined);
    if (budget) return budget;
    const llmSettings = await getLlmSettings();
    const claimedAt = await claimRetry(conversation);
    if (!claimedAt) return retryConflict();

    let run;
    try {
      run = await prisma.extractionRun.create({
        data: {
          conversationId,
          corpusId: conversation.corpusId,
          kind: 'extract',
          model: parsed.data.model || llmSettings.model,
          promptVersion: parsed.data.promptVersion || '2.0.0',
          status: 'pending',
          params: { windowSize: '5min', structuredOutput: true },
        },
      });

      const { analyzeQueue } = await import('@/lib/queue/config');
      await enqueueRetry(analyzeQueue, 'analyze', {
        conversationId,
        extractionRunId: run.id,
      }, `retry-${conversationId}-${claimedAt.getTime()}`);
    } catch (error) {
      if (error instanceof RetrySubmissionError && !error.confirmedAbsent) throw error;
      try {
        if (run) await prisma.extractionRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date() } });
      } finally {
        await releaseRetry(conversation, claimedAt);
      }
      throw error;
    }

    logger.info('Re-extraction run created', { conversationId, runId: run.id });

    return NextResponse.json({
      success: true,
      data: {
        runId: run.id,
        status: run.status,
        model: run.model,
        promptVersion: run.promptVersion,
      },
    });
  } catch (error) {
    logger.error('Re-extract failed', { error: String(error) });
    if (error instanceof RetrySubmissionError && !error.confirmedAbsent) {
      return NextResponse.json({ success: false, kind: 'enqueue_uncertain', error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create extraction run' },
      { status: 503 },
    );
  }
}
