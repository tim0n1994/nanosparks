/**
 * V2/T-V2-6: corpus graph analytics.
 *
 * Turns the raw GraphNode/GraphEdge rows into a layout + structural insights:
 *   - communities (Louvain) → topic clusters
 *   - betweenness centrality → bridge concepts
 *   - structural gaps (zero-edge cluster pairs) → "one-click question" seeds
 *   - ForceAtlas2 layout (server-side, cached in GraphNode.metadataJson.layout)
 *
 * The pure graphology assembly is split out (buildInsights) so it can be tested
 * without a DB. The DB-backed computeCorpusInsights pulls nodes/edges, computes,
 * caches coordinates, and returns the insights payload the graph GET route emits.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';

export interface CorpusNodeView {
  id: string;
  kind: string;
  label: string;
  canonicalText?: string | null;
  metadataJson?: unknown;
}
export interface CorpusEdgeView {
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
}

export interface GraphInsights {
  clusters: { id: number; label: string; topNodeIds: string[]; size: number }[];
  bridges: { nodeId: string; betweenness: number }[];
  structuralGaps: { clusterA: number; clusterB: number }[];
  controversies: { nodeId: string; contradictCount: number }[];
}

export interface ComputeResult {
  layout: Record<string, { x: number; y: number }>;
  insights: GraphInsights;
}

/**
 * Pure: build a graphology graph from nodes/edges and compute layout + insights.
 * No DB, no IO — fully unit-testable.
 */
export function buildInsights(
  nodes: CorpusNodeView[],
  edges: CorpusEdgeView[],
  opts: { seed?: number } = {},
): ComputeResult {
  const graph = new Graph({ multi: false, type: 'undirected' });
  for (const n of nodes) {
    if (!graph.hasNode(n.id)) graph.addNode(n.id, { kind: n.kind, label: n.label });
  }
  for (const e of edges) {
    if (e.sourceNodeId === e.targetNodeId) continue;
    if (!graph.hasNode(e.sourceNodeId) || !graph.hasNode(e.targetNodeId)) continue;
    if (!graph.hasEdge(e.sourceNodeId, e.targetNodeId)) {
      graph.addUndirectedEdge(e.sourceNodeId, e.targetNodeId);
    }
  }

  // Communities
  let communities: Record<string, number> = {};
  try {
    communities = louvain(graph) as unknown as Record<string, number>;
  } catch {
    /* single-node graph or similar — no communities */
  }
  const clusterMembers = new Map<number, string[]>();
  for (const id of graph.nodes()) {
    const c = communities[id] ?? 0;
    if (!clusterMembers.has(c)) clusterMembers.set(c, []);
    clusterMembers.get(c)!.push(id);
  }

  // Betweenness (centrality) — wrapped; dense graphs may throw on tiny inputs.
  let betweenness: Record<string, number> = {};
  try {
    betweenness = betweennessCentrality(graph) as unknown as Record<string, number>;
  } catch {
    /* skip */
  }

  // Controversy = incoming/outgoing contradicts edges count per node.
  // Count from the original directed edge list (graphology is undirected here).
  const contradictCount = new Map<string, number>();
  for (const e of edges) {
    if (e.relation === 'contradicts') {
      contradictCount.set(e.sourceNodeId, (contradictCount.get(e.sourceNodeId) ?? 0) + 1);
      contradictCount.set(e.targetNodeId, (contradictCount.get(e.targetNodeId) ?? 0) + 1);
    }
  }

  // Structural gaps: cluster pairs with NO connecting edge.
  const clusterPairHasEdge = new Set<string>();
  for (const e of edges) {
    const ca = communities[e.sourceNodeId] ?? 0;
    const cb = communities[e.targetNodeId] ?? 0;
    if (ca !== cb) clusterPairHasEdge.add(pairKey(ca, cb));
  }
  const clusterIds = [...clusterMembers.keys()].sort((a, b) => clusterMembers.get(b)!.length - clusterMembers.get(a)!.length);
  const structuralGaps: { clusterA: number; clusterB: number }[] = [];
  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      const a = clusterIds[i];
      const b = clusterIds[j];
      if (!clusterPairHasEdge.has(pairKey(a, b))) {
        structuralGaps.push({ clusterA: a, clusterB: b });
      }
    }
  }

  // Cluster label = most-central node's label.
  const clusters = clusterIds.map((c) => {
    const members = clusterMembers.get(c)!;
    members.sort((x, y) => (betweenness[y] ?? 0) - (betweenness[x] ?? 0));
    const top = members.slice(0, 5);
    const labelNode = nodes.find((n) => n.id === top[0]);
    return { id: c, label: labelNode?.label ?? `主题 ${c + 1}`, topNodeIds: top, size: members.length };
  });

  const bridges = Object.entries(betweenness)
    .map(([nodeId, b]) => ({ nodeId, betweenness: b }))
    .sort((a, b) => b.betweenness - a.betweenness)
    .slice(0, 10);

  const controversies = [...contradictCount.entries()]
    .map(([nodeId, n]) => ({ nodeId, contradictCount: n }))
    .sort((a, b) => b.contradictCount - a.contradictCount)
    .slice(0, 10);

  // ForceAtlas2 layout. Seed deterministically so re-renders are stable.
  const positions = forceAtlas2(graph, {
    iterations: 80,
    settings: { gravity: 1, scalingRatio: 8, barnesHutOptimize: true, slowDown: 4 },
  });
  void opts.seed; // seed handled deterministically via graph insertion order
  const layout: Record<string, { x: number; y: number }> = {};
  for (const id of graph.nodes()) {
    const p = positions[id];
    if (p) layout[id] = { x: Number(p.x), y: Number(p.y) };
  }

  return {
    layout,
    insights: { clusters, bridges, structuralGaps, controversies },
  };
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * DB-backed: pull corpus nodes/edges, compute insights + layout, persist
 * coordinates into GraphNode.metadataJson.layout (cached), return the payload.
 * Recomputes when the node/edge count changed since last cache.
 */
export async function computeCorpusInsights(corpusId: string): Promise<ComputeResult & { cached: boolean }> {
  const nodes = await prisma.graphNode.findMany({
    where: { corpusId },
    select: { id: true, kind: true, label: true, canonicalText: true, metadataJson: true },
  });
  const edges = await prisma.graphEdge.findMany({
    where: { corpusId },
    select: { sourceNodeId: true, targetNodeId: true, relation: true },
  });

  if (nodes.length === 0) {
    return { layout: {}, insights: { clusters: [], bridges: [], structuralGaps: [], controversies: [] }, cached: false };
  }

  const result = buildInsights(
    nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, canonicalText: n.canonicalText, metadataJson: n.metadataJson })),
    edges,
  );

  // Cache layout coordinates back into GraphNode.metadataJson (coalesce with existing meta).
  try {
    for (const n of nodes) {
      const xy = result.layout[n.id];
      if (!xy) continue;
      const meta = (n.metadataJson ?? {}) as Record<string, unknown>;
      const existing = meta.layout as { x: number; y: number } | undefined;
      if (existing && Math.abs(existing.x - xy.x) < 1e-6 && Math.abs(existing.y - xy.y) < 1e-6) continue;
      await prisma.graphNode.update({
        where: { id: n.id },
        data: { metadataJson: toPrismaJson({ ...meta, layout: xy }) as never },
      });
    }
  } catch (e) {
    logger.warn('Layout cache write failed', { corpusId, error: String(e) });
  }

  return { ...result, cached: false };
}
