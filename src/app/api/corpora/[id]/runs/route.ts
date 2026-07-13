/**
 * GET /api/corpora/:id/runs
 *
 * Returns extraction/embedding/graph run history and cost for a corpus.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;

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

    const runs = await prisma.extractionRun.findMany({
      where: { corpusId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        kind: true,
        model: true,
        promptVersion: true,
        status: true,
        costUsd: true,
        startedAt: true,
        finishedAt: true,
        isActive: true,
        conversationId: true,
        _count: { select: { thoughtUnits: true } },
      },
    });

    const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

    return NextResponse.json({
      success: true,
      data: runs,
      meta: {
        totalRuns: runs.length,
        totalCostUsd: totalCost,
        activeRuns: runs.filter((r) => r.isActive).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch runs' },
      { status: 500 },
    );
  }
}
