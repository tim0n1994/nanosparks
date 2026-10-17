// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
  corpus: { findUnique: vi.fn() },
  embeddingProjection: { findMany: vi.fn() },
  thoughtUnit: { findMany: vi.fn(), groupBy: vi.fn() },
  graphNode: { findMany: vi.fn(), count: vi.fn() },
  graphEdge: { findMany: vi.fn(), count: vi.fn() },
  conversation: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/embeddings/projection', () => ({ projectCorpus: vi.fn() }));
vi.mock('@/lib/graph/builder', () => ({ rebuildCorpusGraph: vi.fn() }));
vi.mock('@/lib/graph/analytics', () => ({ computeCorpusInsights: vi.fn(async () => ({ insights: null, layout: {} })) }));
import { GET as atlas } from '@/app/api/corpora/[id]/atlas/route';
import { GET as graph } from '@/app/api/corpora/[id]/graph/route';

const evidence = { turnId: 'turn-42', startMs: 42000, quote: 'Original words' };
const params = { params: Promise.resolve({ id: 'corpus' }) };
beforeEach(() => {
  vi.clearAllMocks();
  db.corpus.findUnique.mockResolvedValue({ id: 'corpus', _count: { conversations: 1, sources: 1 } });
  db.thoughtUnit.findMany.mockResolvedValue([{ id: 'tu', text: 'Derived claim', type: 'claim', conversationId: 'actual', evidenceSpans: [evidence] }]);
  db.thoughtUnit.groupBy.mockResolvedValue([]);
  db.graphNode.findMany.mockResolvedValue([{ id: 'node', metadataJson: { thoughtUnitId: 'tu', conversationId: 'stale' } }]);
  db.graphEdge.findMany.mockResolvedValue([]);
  db.graphNode.count.mockResolvedValue(1);
  db.graphEdge.count.mockResolvedValue(0);
  db.conversation.findMany.mockResolvedValue([]);
  db.embeddingProjection.findMany.mockResolvedValue([{ id: 'point', embeddingId: 'tu', x: 0, y: 0 }]);
});

describe('visualization evidence contracts', () => {
  it('uses the actual thought-unit conversation and original evidence in graph results', async () => {
    const response = await graph(new NextRequest('http://localhost/api/corpora/corpus/graph'), params);
    const result = await response.json();
    expect(result.graph.nodes[0]).toMatchObject({ evidenceConversationId: 'actual', evidence });
    expect(db.thoughtUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['tu'] }, conversation: { corpusId: 'corpus' } } }));
  });
  it('returns original evidence alongside atlas points', async () => {
    const response = await atlas(new NextRequest('http://localhost/api/corpora/corpus/atlas'), params);
    expect((await response.json()).data.points[0]).toMatchObject({ conversationId: 'actual', evidence });
    expect(db.thoughtUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['tu'] }, conversation: { corpusId: 'corpus' } } }));
  });
  it('does not fabricate evidence for missing or foreign thought units', async () => {
    db.thoughtUnit.findMany.mockResolvedValue([]);
    const graphResult = await (await graph(new NextRequest('http://localhost/api/corpora/corpus/graph'), params)).json();
    const atlasResult = await (await atlas(new NextRequest('http://localhost/api/corpora/corpus/atlas'), params)).json();
    expect(graphResult.graph.nodes[0]).toMatchObject({ evidence: null, evidenceConversationId: null });
    expect(atlasResult.data.points[0]).toMatchObject({ evidence: null, conversationId: null });
  });
});
