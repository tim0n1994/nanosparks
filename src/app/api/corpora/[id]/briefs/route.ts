/**
 * GET  /api/corpora/:id/briefs — list briefs for a corpus
 * POST /api/corpora/:id/briefs — generate a new brief
 *
 * Brief = synthesis-layer one-pager with citations.
 * Can be generated from: corpus graph subgraph, or Ask page answer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nanoid } from 'nanoid';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const createBriefSchema = z.object({
  title: z.string().min(1),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string(),
    citations: z.array(z.object({
      thoughtUnitId: z.string(),
      quote: z.string(),
    })).optional(),
  })),
  sourceRunId: z.string().optional(),
  visibility: z.enum(['private', 'workspace', 'shared_link', 'public']).default('private'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;

    const briefs = await prisma.brief.findMany({
      where: { corpusId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        visibility: true,
        shareId: true,
        sourceRunId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, data: briefs });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch briefs' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;
    const body = await request.json();
    const parsed = createBriefSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues },
        { status: 400 },
      );
    }

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
      select: { id: true },
    });

    if (!corpus) {
      return NextResponse.json(
        { success: false, error: 'Corpus not found' },
        { status: 404 },
      );
    }

    const brief = await prisma.brief.create({
      data: {
        corpusId,
        title: parsed.data.title,
        sectionsJson: parsed.data.sections,
        sourceRunId: parsed.data.sourceRunId,
        visibility: parsed.data.visibility,
        shareId: parsed.data.visibility === 'shared_link' ? nanoid(12) : null,
      },
    });

    logger.info('Brief created', { briefId: brief.id, corpusId });

    return NextResponse.json({ success: true, data: brief }, { status: 201 });
  } catch (error) {
    logger.error('Brief creation failed', { error: String(error) });
    return NextResponse.json(
      { success: false, error: 'Failed to create brief' },
      { status: 500 },
    );
  }
}
