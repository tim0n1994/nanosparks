/**
 * POST /api/sources
 *
 * Import an existing transcript as a new Source (bypasses STT, goes straight to analysis).
 *
 * Body: { "corpusId": "...", "title": "...", "segments": [...], "speakers": [...] }
 *
 * segments: Array<{ startMs: number, endMs: number, text: string, speakerLabel?: string }>
 * speakers?: Array<{ name: string, role?: string, label?: string }>
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDefaultWorkspace, ensureYouTubeCorpus } from '@/lib/adapters/episode-to-conversation';
import { analyzeQueue } from '@/lib/queue/config';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { corpusId, title, segments, speakers } = body as {
      corpusId?: string;
      title?: string;
      segments?: Array<{ startMs: number; endMs: number; text: string; speakerLabel?: string }>;
      speakers?: Array<{ name: string; role?: string; label?: string }>;
    };

    if (!segments || segments.length === 0) {
      return NextResponse.json({ error: 'Transcript segments are required' }, { status: 400 });
    }

    // Get or create workspace + corpus
    const workspace = await ensureDefaultWorkspace();
    let corpus;
    if (corpusId) {
      corpus = await prisma.corpus.findUnique({ where: { id: corpusId } });
      if (!corpus) {
        return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
      }
    } else {
      corpus = await ensureYouTubeCorpus(workspace.id);
    }

    // Create Source
    const source = await prisma.source.create({
      data: {
        kind: 'transcript_upload',
        sourceType: 'transcript',
        corpusId: corpus.id,
        consentStatus: 'granted',
        visibility: 'private',
        retentionPolicy: 'keep',
        status: 'ready_for_analysis',
      },
    });

    // Create Conversation
    const conversation = await prisma.conversation.create({
      data: {
        title: title ?? `Transcript ${source.id.slice(0, 8)}`,
        sourceId: source.id,
        corpusId: corpus.id,
        status: 'ready_for_analysis',
      },
    });

    // Create turns from transcript segments
    await prisma.turn.createMany({
      data: segments.map((seg, idx) => ({
        conversationId: conversation.id,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        confidence: 1.0,
        turnIndex: idx,
      })),
    });

    // Create participants from speaker metadata
    if (speakers && speakers.length > 0) {
      await prisma.participant.createMany({
        data: speakers.map((speaker) => ({
          conversationId: conversation.id,
          name: speaker.name,
          role: speaker.role ?? null,
          speakerLabel: speaker.label ?? null,
          isResolved: true,
          confidence: 1.0,
        })),
      });
    }

    // Enqueue analysis directly (skip transcribe step)
    await analyzeQueue.add('analyze', {
      conversationId: conversation.id,
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'analyzing' },
    });

    logger.info(`Transcript source created: ${source.id} conversation=${conversation.id}`);

    return NextResponse.json({
      sourceId: source.id,
      conversationId: conversation.id,
      status: 'analyzing',
    }, { status: 201 });
  } catch (error) {
    logger.error('Source creation failed', { error: String(error) });
    return NextResponse.json({ error: 'Source creation failed' }, { status: 500 });
  }
}

/**
 * GET /api/sources/:id - Get source status and details
 * Implemented in [id] route.
 */
