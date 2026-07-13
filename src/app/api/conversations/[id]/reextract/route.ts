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
    const body = await request.json();
    const parsed = reextractSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues },
        { status: 400 },
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, corpusId: true, source: { select: { consentStatus: true } } },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const llmSettings = await getLlmSettings();

    // Create a new ExtractionRun
    const run = await prisma.extractionRun.create({
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

    // Enqueue the analyze job with the run ID
    const { analyzeQueue } = await import('@/lib/queue/config');
    await analyzeQueue.add('analyze', {
      conversationId,
      extractionRunId: run.id,
    });

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
    return NextResponse.json(
      { success: false, error: 'Failed to create extraction run' },
      { status: 500 },
    );
  }
}
