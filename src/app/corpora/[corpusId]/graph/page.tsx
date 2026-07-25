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
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import PageShell from '@/components/ui/PageShell';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Graph3DData } from '@/components/visualization/KnowledgeGraph3D';
import GraphExplorer from '@/components/visualization/GraphExplorer';
import SemanticAtlas from '@/components/visualization/SemanticAtlas';

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
    insights?: Graph3DData['insights'];
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

  if (loadingDisplay || error || !data) {
    return (
      <PageShell
        loading={loadingDisplay}
        error={error || (!data ? t('graph.noData') : null)}
        onRetry={() => {
          setLoadingDisplay(true);
          setError('');
          void loadGraph();
        }}
        breadcrumb={{ href: '/corpora', label: t('corpora.allCollections') }}
      />
    );
  }

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

  // Tinted with alpha so the panels read correctly in both themes; the old
  // bg-blue-50/border-blue-200 pairs were light-mode-only.
  const quadrants = [
    { title: t('graph.quadrant.claims'), items: claims, color: 'border-blue-500/30 bg-blue-500/5' },
    { title: t('graph.quadrant.objections'), items: objections, color: 'border-red-500/30 bg-red-500/5' },
    { title: t('graph.quadrant.questions'), items: openQuestions, color: 'border-amber-500/30 bg-amber-500/5' },
    { title: t('graph.quadrant.decisions'), items: decisions, color: 'border-emerald-500/30 bg-emerald-500/5' },
  ];

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        <Link
          href="/corpora"
          className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <span aria-hidden="true">←</span> {t('corpora.allCollections')}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.corpus.name}</h1>
          <Link
            href={`/corpora/${corpusId}/ask`}
            className="text-sm font-medium text-link hover:underline"
          >
            {t('graph.askThis')}
          </Link>
        </div>
        {data.corpus.description && (
          <p className="mb-6 text-ink-muted">{data.corpus.description}</p>
        )}

        {/* Stats bar */}
        <div className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span>{t('graph.episodes', { count: data.stats.conversations })}</span>
          <span>·</span>
          <span>{t('graph.nodes', { count: data.stats.graphNodes })}</span>
          <span>·</span>
          <span>{t('graph.edges', { count: data.stats.graphEdges })}</span>
          <span>·</span>
          <span>{t('graph.units', { count: totalTUs })}</span>
        </div>

        {/* V2.1: 全屏沉浸式 3D 知识图谱（three.js / 3d-force-graph）+ 浮层控制台 */}
        <div className="mb-8">
          <GraphExplorer
            corpusId={corpusId}
            nodes={data.graph.nodes}
            edges={data.graph.edges}
            insights={data.graph.insights}
          />
        </div>

        {/* V2/T-V2-8: semantic star map (server-projected UMAP) */}
        <div className="mb-8">
          <SemanticAtlas corpusId={corpusId} />
        </div>

        {/* Four quadrants */}
        <div className="mb-8 grid gap-6 sm:grid-cols-2">
          {quadrants.map((q) => (
            <section key={q.title} className={`rounded-xl border p-4 ${q.color}`}>
              <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">
                {q.title}
                <span className="ml-2 text-sm font-normal text-ink-muted">{q.items.length}</span>
              </h2>
              {q.items.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('graph.quadrantEmpty')}</p>
              ) : (
                <ul className="space-y-2">
                  {q.items.slice(0, 10).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-expanded={expandedNode === item.id}
                        className="w-full rounded text-left text-sm text-ink-subtle transition-colors hover:text-link"
                        onClick={() => setExpandedNode(expandedNode === item.id ? null : item.id)}
                      >
                        {item.label}
                      </button>
                      {expandedNode === item.id && (
                        <div className="ml-4 mt-2 rounded-lg border border-line bg-surface-raised p-2 text-xs">
                          <p className="text-ink-muted">{t(`kind.${item.kind}`)}</p>
                          <Link
                            href={`/corpora/${corpusId}?focus=${item.id}`}
                            className="mt-1 inline-block text-link hover:underline"
                          >
                            {t('graph.viewInTranscript')}
                          </Link>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* Thought unit type distribution */}
        <section className="rounded-xl border border-line bg-surface-raised p-4">
          <h2 className="section-label mb-3">{t('graph.distribution')}</h2>
          <div className="flex flex-wrap gap-2">
            {tuStats.map((stat) => (
              <span
                key={stat.type}
                className="rounded-full bg-surface-sunken px-3 py-1 text-xs text-ink-subtle"
              >
                {t(`kind.${stat.type}`)} {stat._count}
              </span>
            ))}
          </div>
        </section>

        {/* Graph edges list (supports/contradicts) */}
        {data.graph.edges.length > 0 && (
          <section className="mt-6 rounded-xl border border-line bg-surface-raised p-4">
            <h2 className="section-label mb-3">{t('graph.relations', { count: data.graph.edges.length })}</h2>
            <ul className="max-h-[400px] space-y-1 overflow-y-auto">
              {data.graph.edges.slice(0, 50).map((edge) => (
                <li key={edge.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  <span className="font-medium">{edge.sourceNode.label}</span>
                  <span
                    className={
                      edge.relation === 'contradicts'
                        ? 'text-red-600 dark:text-red-400'
                        : edge.relation === 'supports'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-ink-muted'
                    }
                  >
                    {t(`relation.${edge.relation}`)}
                  </span>
                  <span className="font-medium">{edge.targetNode.label}</span>
                  <span className="text-ink-muted">{Math.round(edge.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

