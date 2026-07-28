'use client';

/**
 * V2/T-V2-8: semantic star map (corpus-wide UMAP projection).
 *
 * Renders the precomputed EmbeddingProjection points as a positioned scatter
 * plot, colored by cluster, with a click → evidence card (text + reader link).
 *
 * Implementation note: uses absolutely-positioned DOM elements rather than
 * deck.gl/WebGL. A single corpus is well under the DOM threshold (≤ a few
 * thousand TUs), the backend already did the expensive UMAP/cluster math, and a
 * DOM render stays testable in jsdom and crisp on retina without canvas pixel
 * checks. deck.gl remains an option for the optional 3D orbit easter-egg (P2).
 */

import { useEffect, useMemo, useState } from 'react';

export interface AtlasPoint {
  id: string;
  embeddingId: string;
  x: number;
  y: number;
  clusterId: number | null;
  clusterLabel?: string | null;
  text: string | null;
  type: string | null;
  conversationId: string | null;
}

interface Props {
  corpusId: string;
}

const CLUSTER_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

function clusterColor(clusterId: number | null): string {
  if (clusterId == null || clusterId < 0) return '#9ca3af';
  return CLUSTER_PALETTE[clusterId % CLUSTER_PALETTE.length];
}

/** Normalize raw UMAP coords into a [0,1] box for layout. */
function normalize(points: AtlasPoint[]): { norm: Map<string, { x: number; y: number }>; empty: boolean } {
  if (points.length === 0) return { norm: new Map(), empty: true };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const norm = new Map<string, { x: number; y: number }>();
  for (const p of points) {
    norm.set(p.id, { x: (p.x - minX) / spanX, y: (p.y - minY) / spanY });
  }
  return { norm, empty: false };
}

export default function SemanticAtlas({ corpusId }: Props) {
  const [points, setPoints] = useState<AtlasPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AtlasPoint | null>(null);
  const [colorBy, setColorBy] = useState<'cluster' | 'conversation'>('cluster');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/corpora/${corpusId}/atlas`)
      .then((r) => (r.ok ? r.json() : { data: { points: [] } }))
      .then((j) => {
        if (!cancelled) setPoints(Array.isArray(j.data?.points) ? j.data.points : []);
      })
      .catch(() => { if (!cancelled) setPoints([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [corpusId]);

  const { norm, empty } = useMemo(() => normalize(points), [points]);
  const convColor = useMemo(() => {
    const map = new Map<string, string>();
    let i = 0;
    for (const p of points) {
      const k = p.conversationId ?? 'none';
      if (!map.has(k)) {
        map.set(k, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]);
        i++;
      }
    }
    return map;
  }, [points]);

  const [projecting, setProjecting] = useState(false);
  const triggerProjection = async () => {
    setProjecting(true);
    try {
      const r = await fetch(`/api/corpora/${corpusId}/atlas`, { method: 'POST' });
      if (r.ok) {
        // Refetch the now-populated projection points.
        const fresh = await fetch(`/api/corpora/${corpusId}/atlas`).then((x) => x.ok ? x.json() : { data: { points: [] } });
        setPoints(Array.isArray(fresh.data?.points) ? fresh.data.points : []);
      }
    } catch { /* surface silently */ } finally {
      setProjecting(false);
    }
  };

  if (loading) {
    return <div className="flex h-[420px] items-center justify-center text-sm text-overlay-ink-muted">…</div>;
  }
  if (empty) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-sm text-overlay-ink-muted">
        <span>还没有语义星图数据</span>
        <button
          type="button"
          onClick={triggerProjection}
          disabled={projecting}
          className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {projecting ? '生成中…' : '生成语义星图'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="relative flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-subtle">语义星图</h3>
          <div className="inline-flex rounded-lg border border-line bg-surface-raised p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setColorBy('cluster')}
              className={`rounded px-2 py-1 ${colorBy === 'cluster' ? 'bg-overlay text-white' : 'text-overlay-ink-muted'}`}
            >
              Cluster
            </button>
            <button
              type="button"
              onClick={() => setColorBy('conversation')}
              className={`rounded px-2 py-1 ${colorBy === 'conversation' ? 'bg-overlay text-white' : 'text-overlay-ink-muted'}`}
            >
              Episode
            </button>
          </div>
        </div>

        <div className="relative h-[420px] overflow-hidden rounded-xl border border-line bg-surface-sunken">
          {points.map((p) => {
            const c = norm.get(p.id);
            if (!c) return null;
            const color = colorBy === 'cluster'
              ? clusterColor(p.clusterId)
              : convColor.get(p.conversationId ?? 'none') ?? '#9ca3af';
            return (
              <button
                key={p.id}
                type="button"
                title={p.text ?? p.id}
                onClick={() => setSelected(p)}
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full hover:scale-150 hover:z-10"
                style={{
                  left: `${4 + c.x * 92}%`,
                  top: `${4 + c.y * 92}%`,
                  backgroundColor: color,
                }}
              />
            );
          })}

          {selected && (
            <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-surface-raised p-3 shadow-lg">
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xs font-medium uppercase tracking-wide text-overlay-ink-muted">{selected.type ?? 'point'}</span>
                <button type="button" onClick={() => setSelected(null)} className="text-overlay-ink-muted hover:text-ink-subtle" aria-label="Close">×</button>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink">{selected.text ?? selected.id}</p>
              {selected.conversationId && (
                <a className="mt-2 inline-block text-2xs font-medium text-link hover:underline" href={`/read/${selected.conversationId}`}>
                  进阅读器 →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
