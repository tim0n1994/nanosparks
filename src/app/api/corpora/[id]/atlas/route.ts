/**
 * GET /api/corpora/:id/atlas
 *
 * V2/T-V2-8: returns the semantic star-map points for a corpus (precomputed
 * EmbeddingProjection rows). Each point carries the thought-unit text +
 * conversationId so the frontend can show an evidence card and link to the
 * reader. POST triggers a fresh projection (worker-style, synchronous here for
 * simplicity — typically called by an admin/cron action).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { projectCorpus } from '@/lib/embeddings/projection';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;

    const corpus = await prisma.corpus.findUnique({ where: { id: corpusId }, select: { id: true } });
    if (!corpus) {
      return NextResponse.json({ success: false, error: 'Corpus not found' }, { status: 404 });
    }

    const rows = await prisma.embeddingProjection.findMany({
      where: { corpusId },
      orderBy: { clusterId: 'asc' },
      select: { id: true, embeddingId: true, x: true, y: true, clusterId: true, clusterLabel: true },
    });

    // Join the thought-unit text + conversationId for evidence cards.
    const tuIds = rows.map((r) => r.embeddingId);
    const tus = tuIds.length > 0
      ? await prisma.thoughtUnit.findMany({
          where: { id: { in: tuIds }, conversation: { corpusId } },
          select: {
            id: true, text: true, conversationId: true, type: true,
            evidenceSpans: {
              orderBy: [{ startMs: 'asc' }, { id: 'asc' }], take: 1,
              select: { turnId: true, startMs: true, quote: true },
            },
          },
        })
      : [];
    const tuById = new Map(tus.map((t) => [t.id, t]));

    const points = rows.map((r) => {
      const tu = tuById.get(r.embeddingId);
      return {
        id: r.id,
        embeddingId: r.embeddingId,
        x: r.x,
        y: r.y,
        clusterId: r.clusterId,
        clusterLabel: r.clusterLabel,
        text: tu?.text ?? null,
        type: tu?.type ?? null,
        conversationId: tu?.conversationId ?? null,
        evidence: tu?.evidenceSpans[0] ?? null,
      };
    });

    return NextResponse.json({ success: true, data: { points }, meta: { count: points.length } });
  } catch (error) {
    logger.error('Failed to fetch atlas', { error: String(error) });
    return NextResponse.json({ success: false, error: 'Failed to fetch atlas' }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;
    const corpus = await prisma.corpus.findUnique({ where: { id: corpusId }, select: { id: true } });
    if (!corpus) {
      return NextResponse.json({ success: false, error: 'Corpus not found' }, { status: 404 });
    }
    const result = await projectCorpus(corpusId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logger.error('Atlas projection failed', { error: String(error) });
    return NextResponse.json({ success: false, error: 'Atlas projection failed' }, { status: 500 });
  }
}
