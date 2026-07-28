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
import { computeCorpusInsights } from '@/lib/graph/analytics';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
      include: {
        _count: { select: { conversations: true, sources: true } },
      },
    });

    if (!corpus) {
      return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
    }

    // Fetch graph data. Cap nodes at 500 — a 16k-node payload is ~10MB and
    // pins the main thread for 13s on load. The insight deck (clusters,
    // bridges, gaps) is computed over the full graph below, so capping the
    // visualised subset loses no conclusions, only unbrowsegable noise.
    const GRAPH_NODE_LIMIT = 500;
    const nodes = await prisma.graphNode.findMany({
      where: { corpusId },
      orderBy: { createdAt: 'desc' },
      take: GRAPH_NODE_LIMIT,
    });
    const nodeIds = nodes.map((n) => n.id);

    // Only return edges whose both endpoints are in the capped node set,
    // so the 3D view and list never show dangling references.
    const edges = await prisma.graphEdge.findMany({
      where: { corpusId, sourceNodeId: { in: nodeIds }, targetNodeId: { in: nodeIds } },
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

    // V2/T-V2-6: server-side layout + structural insights (communities, bridges,
    // structural gaps, controversies). Best-effort — never blocks the graph view.
    let insights: { clusters: unknown[]; bridges: unknown[]; structuralGaps: unknown[]; controversies: unknown[] } | null = null;
    let layout: Record<string, { x: number; y: number }> = {};
    try {
      const computed = await computeCorpusInsights(corpusId);
      insights = computed.insights;
      layout = computed.layout;
    } catch (e) {
      logger.warn('Corpus insights computation failed', { corpusId, error: String(e) });
    }

    // True totals — the nodes/edges arrays are capped (GRAPH_NODE_LIMIT), so
    // use count() for the stats panel, not .length on the visualised subset.
    const [realGraphNodeCount, realGraphEdgeCount] = await Promise.all([
      prisma.graphNode.count({ where: { corpusId } }),
      prisma.graphEdge.count({ where: { corpusId } }),
    ]);

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
        layout,
        insights,
      },
      stats: {
        thoughtUnits: thoughtUnitCounts,
        conversations: conversations.length,
        graphNodes: realGraphNodeCount,
        graphEdges: realGraphEdgeCount,
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
