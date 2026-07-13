/**
 * GET /api/corpora/:id/graph
 *
 * Returns the insight graph for a corpus:
 * - nodes: claim clusters, topics, participants
 * - edges: supports/contradicts/refines relations
 * - metadata: conversation count, thought unit stats
 *
 * POST /api/corpora/:id/graph/rebuild
 * Force rebuild the graph from thought units.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rebuildCorpusGraph } from '@/lib/graph/builder';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const corpusId = params.id;

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
      include: {
        _count: { select: { conversations: true, sources: true } },
      },
    });

    if (!corpus) {
      return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
    }

    // Fetch graph data
    const nodes = await prisma.graphNode.findMany({
      where: { corpusId },
      orderBy: { createdAt: 'desc' },
    });

    const edges = await prisma.graphEdge.findMany({
      where: { corpusId },
      include: {
        sourceNode: { select: { id: true, label: true, kind: true } },
        targetNode: { select: { id: true, label: true, kind: true } },
      },
    });

    // Get thought unit stats for context
    const thoughtUnitCounts = await prisma.thoughtUnit.groupBy({
      by: ['type'],
      where: {
        conversation: { corpusId },
      },
      _count: true,
    });

    // Get conversation list with titles
    const conversations = await prisma.conversation.findMany({
      where: { corpusId, status: 'completed' },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      corpus: {
        id: corpus.id,
        name: corpus.name,
        description: corpus.description,
        conversationCount: corpus._count.conversations,
        sourceCount: corpus._count.sources,
      },
      graph: {
        nodes,
        edges,
      },
      stats: {
        thoughtUnits: thoughtUnitCounts,
        conversations: conversations.length,
        graphNodes: nodes.length,
        graphEdges: edges.length,
      },
      conversations,
    });
  } catch (error) {
    logger.error('Failed to fetch corpus graph', { error: String(error) });
    return NextResponse.json({ error: 'Failed to fetch corpus graph' }, { status: 500 });
  }
}

/**
 * POST /api/corpora/:id/graph/rebuild
 * Force rebuild the insight graph for this corpus.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const corpusId = params.id;

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
    });

    if (!corpus) {
      return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
    }

    const result = await rebuildCorpusGraph(corpusId);

    return NextResponse.json({
      message: 'Graph rebuilt successfully',
      nodesCreated: result.nodesCreated,
      edgesCreated: result.edgesCreated,
    });
  } catch (error) {
    logger.error('Failed to rebuild corpus graph', { error: String(error) });
    return NextResponse.json({ error: 'Failed to rebuild corpus graph' }, { status: 500 });
  }
}
