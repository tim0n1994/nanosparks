/**
 * Corpus Graph Page — Four Quadrant View
 *
 * Per Track E.2: top claims / objections / open questions / decisions
 * four-quadrant + participant distribution + expandable evidence
 * with timestamp jump links.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LoadingSpinner from '@/components/loading-spinner';
import InsightGraph, { type InsightGraphData } from '@/components/visualization/InsightGraph';

interface GraphData {
  corpus: { id: string; name: string; description: string | null };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; metadataJson: unknown }>;
    edges: Array<{
      id: string;
      relation: string;
      confidence: number;
      sourceNode: { id: string; label: string; kind: string };
      targetNode: { id: string; label: string; kind: string };
    }>;
    layout?: Record<string, { x: number; y: number }>;
    insights?: InsightGraphData['insights'];
  };
  stats: {
    thoughtUnits: Array<{ type: string; _count: number }>;
    conversations: number;
    graphNodes: number;
    graphEdges: number;
  };
}

interface QuadrantItem {
  id: string;
  label: string;
  kind: string;
  evidence?: string;
}

export default function CorpusGraphPage() {
  const params = useParams();
  const corpusId = params.corpusId as string;
  const { t } = useTranslation();

  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const loadingRef = useRef(true);
  const [loadingDisplay, setLoadingDisplay] = useState(true);

  const loadGraph = useCallback(async () => {
    try {
      const res = await fetch(`/api/corpora/${corpusId}/graph`);
      if (!res.ok) throw new Error('Failed to load graph');
      const json = await res.json();
      setData(json);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      loadingRef.current = false;
      setLoadingDisplay(false);
    }
  }, [corpusId]);

  useEffect(() => {
    // loadGraph is async — setState calls happen in callbacks, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGraph();
  }, [loadGraph]);

  if (loadingDisplay) return <LoadingSpinner />;
  if (error) return <div className="p-8 text-red-500">{error}</div>;
  if (!data) return null;

  // Group nodes by kind into four quadrants
  const nodes = data.graph.nodes;
  const claims: QuadrantItem[] = nodes
    .filter((n) => n.kind === 'claim_cluster' || n.kind === 'topic')
    .map((n) => ({ id: n.id, label: n.label, kind: n.kind }));
  const decisions: QuadrantItem[] = nodes
    .filter((n) => n.kind === 'decision')
    .map((n) => ({ id: n.id, label: n.label, kind: n.kind }));
  const openQuestions: QuadrantItem[] = nodes
    .filter((n) => n.kind === 'open_question')
    .map((n) => ({ id: n.id, label: n.label, kind: n.kind }));
  const objections: QuadrantItem[] = data.graph.edges
    .filter((e) => e.relation === 'contradicts')
    .map((e) => ({ id: e.id, label: `${e.sourceNode.label} ↔ ${e.targetNode.label}`, kind: 'contradicts' }));

  // Participant distribution from thought unit stats
  const tuStats = data.stats.thoughtUnits;
  const totalTUs = tuStats.reduce((sum, s) => sum + s._count, 0);

  const quadrants = [
    { title: 'Top Claims', items: claims, color: 'bg-blue-50 border-blue-200', icon: '💡' },
    { title: 'Objections', items: objections, color: 'bg-red-50 border-red-200', icon: '⚔️' },
    { title: 'Open Questions', items: openQuestions, color: 'bg-yellow-50 border-yellow-200', icon: '❓' },
    { title: 'Decisions', items: decisions, color: 'bg-green-50 border-green-200', icon: '✅' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{data.corpus.name}</h1>
        {data.corpus.description && (
          <p className="text-gray-500 mb-6">{data.corpus.description}</p>
        )}

        {/* Stats bar */}
        <div className="flex gap-4 mb-6 text-sm text-gray-500">
          <span>{data.stats.conversations} conversations</span>
          <span>·</span>
          <span>{data.stats.graphNodes} nodes</span>
          <span>·</span>
          <span>{data.stats.graphEdges} edges</span>
          <span>·</span>
          <span>{totalTUs} thought units</span>
        </div>

        {/* V2/T-V2-7: sigma insight graph (server-layout) + insight panel */}
        <div className="mb-8">
          <InsightGraph
            corpusId={corpusId}
            data={{
              nodes: data.graph.nodes,
              edges: data.graph.edges,
              layout: data.graph.layout,
              insights: data.graph.insights,
            }}
          />
        </div>

        {/* Four quadrants */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {quadrants.map((q) => (
            <div key={q.title} className={`rounded-lg border p-4 ${q.color}`}>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                <span className="mr-2">{q.icon}</span>{q.title}
                <span className="ml-2 text-sm text-gray-400">({q.items.length})</span>
              </h2>
              {q.items.length === 0 ? (
                <p className="text-sm text-gray-400">No items</p>
              ) : (
                <ul className="space-y-2">
                  {q.items.slice(0, 10).map((item) => (
                    <li key={item.id}>
                      <button
                        className="text-sm text-left w-full hover:text-primary-600 transition-colors"
                        onClick={() => setExpandedNode(expandedNode === item.id ? null : item.id)}
                      >
                        {item.label}
                      </button>
                      {expandedNode === item.id && (
                        <div className="mt-2 ml-4 p-2 bg-white rounded border text-xs text-gray-600">
                          <p>Type: {item.kind}</p>
                          <p>ID: {item.id}</p>
                          <button
                            className="mt-1 text-primary-600 hover:underline"
                            onClick={() => window.open(`/corpora/${corpusId}?focus=${item.id}`, '_self')}
                          >
                            View in conversation →
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Thought unit type distribution */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Thought Unit Distribution</h2>
          <div className="flex gap-2 flex-wrap">
            {tuStats.map((stat) => (
              <div
                key={stat.type}
                className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700"
              >
                {stat.type}: {stat._count}
              </div>
            ))}
          </div>
        </div>

        {/* Graph edges list (supports/contradicts) */}
        {data.graph.edges.length > 0 && (
          <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Relations ({data.graph.edges.length})
            </h2>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {data.graph.edges.slice(0, 50).map((edge) => (
                <div key={edge.id} className="text-xs text-gray-600 flex items-center gap-2">
                  <span className="font-medium">{edge.sourceNode.label}</span>
                  <span className={
                    edge.relation === 'contradicts' ? 'text-red-500' :
                    edge.relation === 'supports' ? 'text-green-500' :
                    'text-gray-400'
                  }>
                    {edge.relation}
                  </span>
                  <span className="font-medium">{edge.targetNode.label}</span>
                  <span className="text-gray-300">({Math.round(edge.confidence * 100)}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
