import { describe, it, expect } from 'vitest';
import { buildInsights, type CorpusNodeView, type CorpusEdgeView } from '@/lib/graph/analytics';

const n = (id: string, label: string, kind = 'claim_cluster'): CorpusNodeView => ({ id, kind, label });
const e = (sourceNodeId: string, targetNodeId: string, relation = 'supports'): CorpusEdgeView => ({
  sourceNodeId,
  targetNodeId,
  relation,
});

describe('buildInsights (V2/T-V2-6)', () => {
  it('returns empty insights for an empty graph', () => {
    const res = buildInsights([], []);
    expect(res.insights.clusters).toEqual([]);
    expect(res.insights.bridges).toEqual([]);
    expect(res.layout).toEqual({});
  });

  it('computes a layout coordinate per node', () => {
    const nodes = [n('a', 'A'), n('b', 'B')];
    const res = buildInsights(nodes, [e('a', 'b')]);
    expect(res.layout.a).toBeDefined();
    expect(res.layout.b).toBeDefined();
    expect(typeof res.layout.a.x).toBe('number');
  });

  it('counts contradicts edges per node in controversies', () => {
    const nodes = [n('a', 'A'), n('b', 'B'), n('c', 'C')];
    const edges = [e('a', 'b', 'contradicts'), e('a', 'c', 'contradicts')];
    const res = buildInsights(nodes, edges);
    const a = res.insights.controversies.find((c) => c.nodeId === 'a');
    expect(a).toBeTruthy();
    expect(a!.contradictCount).toBe(2);
  });

  it('detects a structural gap between disconnected clusters', () => {
    // two disconnected triangles → 2 communities, 0 inter-cluster edges → gap
    const nodes = [n('a', 'A'), n('b', 'B'), n('c', 'C'), n('d', 'D'), n('e', 'E'), n('f', 'F')];
    const edges = [e('a', 'b'), e('b', 'c'), e('a', 'c'), e('d', 'e'), e('e', 'f'), e('d', 'f')];
    const res = buildInsights(nodes, edges);
    expect(res.insights.clusters.length).toBeGreaterThanOrEqual(2);
    // at least one gap reported between the two clusters
    expect(res.insights.structuralGaps.length).toBeGreaterThanOrEqual(1);
  });

  it('self-loops and unknown endpoints are dropped without throwing', () => {
    const nodes = [n('a', 'A')];
    const res = buildInsights(nodes, [e('a', 'a'), e('a', 'ghost'), e('ghost', 'a')]);
    expect(res.insights.clusters.length).toBeGreaterThanOrEqual(1);
  });
});
