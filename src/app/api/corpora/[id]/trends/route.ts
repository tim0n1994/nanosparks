/**
 * GET /api/corpora/:id/trends
 *
 * Returns a trend report for the corpus:
 * - Top recurring claims
 * - Unresolved questions
 * - Participant activity
 * - Thought unit type distribution
 * - Contested topics (from graph edges)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateCorpusReport } from '@/lib/trends/reporter';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
    });

    if (!corpus) {
      return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
    }

    // Generate trend report
    const report = await generateCorpusReport(corpusId);

    // Enrich with graph edge data for contested topics
    const edges = await prisma.graphEdge.findMany({
      where: { corpusId },
      include: {
        sourceNode: { select: { id: true, label: true, kind: true } },
        targetNode: { select: { id: true, label: true, kind: true } },
      },
    });

    // Calculate contested topics from graph edges
    // Group by node ID first, then map to labels (avoids label collision)
    const nodeContestMap = new Map<string, { label: string; support: number; contradict: number }>();
    for (const edge of edges) {
      const nodeId = edge.sourceNodeId;
      if (!nodeContestMap.has(nodeId)) {
        nodeContestMap.set(nodeId, { label: edge.sourceNode.label, support: 0, contradict: 0 });
      }
      const entry = nodeContestMap.get(nodeId)!;
      if (edge.relation === 'supports') entry.support++;
      if (edge.relation === 'contradicts') entry.contradict++;
    }

    report.contestedTopics = [...nodeContestMap.values()]
      .sort((a, b) => (b.support + b.contradict) - (a.support + a.contradict))
      .slice(0, 10)
      .map((entry) => ({
        topic: entry.label,
        supportCount: entry.support,
        contradictCount: entry.contradict,
        netScore: entry.support - entry.contradict,
      }));

    return NextResponse.json(report);
  } catch (error) {
    logger.error('Failed to generate trend report', { error: String(error) });
    return NextResponse.json({ error: 'Failed to generate trend report' }, { status: 500 });
  }
}
