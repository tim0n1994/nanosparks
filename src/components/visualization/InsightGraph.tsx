'use client';

/**
 * V2/T-V2-7: sigma.js + graphology corpus insight graph.
 *
 * Uses the BACKEND-computed ForceAtlas2 layout coordinates (graph.layout) so the
 * browser never runs a force simulation. Nodes colored by kind, sized by
 * betweenness (from graph.insights.bridges). Click → evidence popover with the
 * node's canonical text + conversation/conversation read-link.
 *
 * The InsightPanel (clusters / bridges / structural gaps / controversies) is a
 * sibling list view: the mobile-equivalent of the network, fully keyboardable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Graph from 'graphology';
import { useTranslation } from '@/lib/i18n/useTranslation';

const KIND_COLORS: Record<string, string> = {
  participant: '#ef4444',
  entity: '#3b82f6',
  claim_cluster: '#8b5cf6',
  topic: '#10b981',
  decision: '#f59e0b',
  open_question: '#06b6d4',
  concept: '#ec4899',
};

// Palette for the color-by-conversation filter (cycles).
const KIND_COLORS_LIST = Object.values(KIND_COLORS);

// Minimal sigma renderer surface we touch (kill + refresh + camera animate +
// node display coords). Loosely typed so the lazy WebGL import stays out of jsdom.
interface RendererLike {
  kill: () => void;
  refresh: () => void;
  camera: { animate: (opts: { x: number; y: number; ratio?: number; duration?: number }) => void };
  getNodeDisplayData?: (id: string) => { x: number; y: number } | undefined;
}

interface GraphNodeView {
  id: string;
  kind: string;
  label: string;
  canonicalText?: string | null;
  metadataJson?: unknown;
}
interface GraphEdgeView {
  id: string;
  relation: string;
  confidence: number;
  sourceNode: { id: string; label: string; kind: string };
  targetNode: { id: string; label: string; kind: string };
}
export interface CorpusInsights {
  clusters: { id: number; label: string; topNodeIds: string[]; size: number }[];
  bridges: { nodeId: string; betweenness: number }[];
  structuralGaps: { clusterA: number; clusterB: number }[];
  controversies: { nodeId: string; contradictCount: number }[];
}
export interface InsightGraphData {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  layout?: Record<string, { x: number; y: number }>;
  insights?: CorpusInsights | null;
}

interface Props {
  corpusId: string;
  data: InsightGraphData;
  /** conversationId used to build the "open in reader" link for evidence. */
  conversationIdFor?: (node: GraphNodeView) => string | null;
}

export default function InsightGraph({ corpusId, data, conversationIdFor }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // Minimal renderer interface we touch (kill + refresh + camera.animate). Keeps
  // sigma typed loosely so the lazy import doesn't pull WebGL into jsdom.
  const sigmaRef = useRef<RendererLike | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [selected, setSelected] = useState<GraphNodeView | null>(null);
  const [view, setView] = useState<'network' | 'list'>('network');
  const [webglFailed, setWebglFailed] = useState(false);
  // V2/T-V2-7 §2.2 L1: in-graph search (highlight + fly-to) + color-by filter.
  const [search, setSearch] = useState('');
  const [colorBy, setColorBy] = useState<'kind' | 'conversation'>('kind');

  const betweenness = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of data.insights?.bridges ?? []) m.set(b.nodeId, b.betweenness);
    return m;
  }, [data.insights]);

  // (Re)build the sigma renderer when nodes/layout change.
 useEffect(() => {
   if (view !== 'network' || !containerRef.current || data.nodes.length === 0) return;

   const graph = new Graph();
   // Normalize layout coords into [0,1]-ish range for stable rendering.
   // Use a loop (not Math.min(...spread)) to avoid RangeError on large graphs.
   const coords = data.layout ?? {};
   let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
   for (const v of Object.values(coords)) {
     if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
     if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
   }
   if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
   const spanX = maxX - minX || 1;
   const spanY = maxY - minY || 1;

   for (const node of data.nodes) {
     const c = coords[node.id];
     const x = c ? (c.x - minX) / spanX : Math.random();
     const y = c ? (c.y - minY) / spanY : Math.random();
     const b = betweenness.get(node.id) ?? 0;
     graph.addNode(node.id, {
       x,
       y,
       size: 4 + Math.min(16, b * 80),
       color: KIND_COLORS[node.kind] ?? '#9ca3af',
       label: node.label,
       nodeData: node,
     });
   }
   for (const edge of data.edges) {
     const s = edge.sourceNode.id;
     const tg = edge.targetNode.id;
     if (graph.hasNode(s) && graph.hasNode(tg) && !graph.hasEdge(s, tg)) {
       graph.addEdge(s, tg, {
         color: edge.relation === 'contradicts' ? '#ef4444' : '#d1d5db',
         size: edge.relation === 'contradicts' ? 1.6 : 0.6,
       });
     }
   }

    // Sigma needs WebGL, so import it lazily — importing the renderer eagerly
    // would crash jsdom (test env) and adds weight to cold loads.
    let cancelled = false;
    const container = containerRef.current;

    // Feature-detect WebGL before attempting sigma — avoids a silent blank
    // canvas when the GPU is unavailable (headless, blocklisted, driver crash).
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    if (!gl) {
      setWebglFailed(true);
      setView('list');
      return;
    }

    void (async () => {
      try {
        const { default: Sigma } = await import('sigma');
        if (cancelled || !container) return;
        const renderer = new Sigma(graph, container, {
          renderEdgeLabels: false,
          labelDensity: 0.3,
          defaultEdgeColor: '#d1d5db',
          labelFont: 'system-ui, sans-serif',
      labelSize: 12,
    });
        sigmaRef.current = renderer as unknown as RendererLike;
        graphRef.current = graph;

        renderer.on('clickNode', ({ node }) => {
          const nd = graph.getNodeAttribute(node, 'nodeData') as GraphNodeView;
          setSelected(nd);
        });
        renderer.on('clickStage', () => setSelected(null));
      } catch {
        // WebGL context lost or sigma init failed — fall back to list view.
        if (!cancelled) {
          setWebglFailed(true);
          setView('list');
        }
      }
    })();

    return () => {
      cancelled = true;
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [view, data, betweenness]);

  // V2/T-V2-7: apply current colorBy + search highlight to the live graph.
  useEffect(() => {
    applyVisualState();
  }, [colorBy, search, data]);

  function applyVisualState() {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph) return;
    const convIds = [...new Set(data.nodes.map((n) => conversationIdFor?.(n) ?? (n.metadataJson as { conversationId?: string } | null)?.conversationId ?? ''))];
    const convColor = new Map<string, string>();
    convIds.forEach((id, i) => convColor.set(id, KIND_COLORS_LIST[i % KIND_COLORS_LIST.length]));
    const q = search.trim().toLowerCase();
    let firstMatchId: string | null = null;
    graph.forEachNode((id, attrs) => {
      const node = attrs.nodeData as GraphNodeView;
      // color
      if (colorBy === 'conversation') {
        const cid = conversationIdFor?.(node) ?? (attrs.nodeData as { conversationId?: string }).conversationId ?? '';
        graph.setNodeAttribute(id, 'color', convColor.get(cid) ?? '#9ca3af');
      } else {
        graph.setNodeAttribute(id, 'color', KIND_COLORS[node.kind] ?? '#9ca3af');
      }
      // search highlight
      const matches = q.length > 0 && node.label.toLowerCase().includes(q);
      if (matches && !firstMatchId) firstMatchId = id;
      const baseSize = 4 + Math.min(16, (betweenness.get(id) ?? 0) * 80);
      graph.setNodeAttribute(id, 'size', matches ? baseSize + 6 : baseSize);
      graph.setNodeAttribute(id, 'label', node.label);
    });
    renderer?.refresh();
    // fly camera to the first matched node
    if (q && firstMatchId && renderer) {
      const nd = renderer.getNodeDisplayData?.(firstMatchId);
      if (nd) renderer.camera.animate({ x: nd.x, y: nd.y, ratio: 0.3, duration: 400 });
    }
  }

  if (data.nodes.length === 0) {
    return <div className="p-8 text-center text-sm text-zinc-400">{t('viz.noData')}</div>;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Network / list view */}
      <div className="flex-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          {/* V2/T-V2-7: in-graph search (highlight + fly-to first match) */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点…"
            className="w-40 rounded-md border border-zinc-200 px-2 py-1 text-xs outline-none focus:border-zinc-400"
          />
          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('network')}
              className={`rounded px-2 py-1 ${view === 'network' ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}
            >
              Network
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={`rounded px-2 py-1 ${view === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}
            >
              List
            </button>
            <span className="mx-1 w-px self-stretch bg-zinc-200" />
            <button
              type="button"
              onClick={() => setColorBy('kind')}
              className={`rounded px-2 py-1 ${colorBy === 'kind' ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}
              title="按类型染色"
            >
              By type
            </button>
            <button
              type="button"
              onClick={() => setColorBy('conversation')}
              className={`rounded px-2 py-1 ${colorBy === 'conversation' ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}
              title="按集染色"
            >
             By ep
           </button>
         </div>
       </div>

        {view === 'network' ? (
          <div className="relative h-[560px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
            <div ref={containerRef} className="h-full w-full" />
            {selected && <NodePopover node={selected} corpusId={corpusId} conversationIdFor={conversationIdFor} onClose={() => setSelected(null)} />}
          </div>
        ) : (
         <ListView data={data} onSelect={setSelected} selected={selected} corpusId={corpusId} conversationIdFor={conversationIdFor} />
         )}
        {/* Node detail popover is shared by both views; in list view the user
            selects a row to surface it, in network view they click a node. */}
        {view === 'list' && selected && (
          <div className="relative mt-2 min-h-[110px]">
            <NodePopover node={selected} corpusId={corpusId} conversationIdFor={conversationIdFor} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>

      {/* Insight panel */}
      <aside className="w-full shrink-0 lg:w-80">
        <InsightPanel insights={data.insights} corpusId={corpusId} />
      </aside>
    </div>
  );
}

function NodePopover({
  node,
  corpusId,
  conversationIdFor,
  onClose,
}: {
  node: GraphNodeView;
  corpusId: string;
  conversationIdFor?: (node: GraphNodeView) => string | null;
  onClose: () => void;
}) {
  const meta = (node.metadataJson ?? {}) as { thoughtUnitId?: string; conversationId?: string; type?: string; stance?: string; speakerName?: string };
  const convId = conversationIdFor?.(node) ?? meta.conversationId ?? null;
  return (
    <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{node.kind}</span>
        <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-700" aria-label="close">×</button>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-zinc-800">{node.canonicalText ?? node.label}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
        {meta.speakerName && <span>· {meta.speakerName}</span>}
        {meta.stance && <span>· {meta.stance}</span>}
        {/* V2/T-V2-9 §2.3 搜索↔图联动：以此节点为问题进入 Ask */}
        <a className="font-medium text-blue-600 hover:underline" href={`/corpora/${corpusId}/ask?q=${encodeURIComponent(node.canonicalText ?? node.label)}`}>
          以此提问 →
        </a>
        {convId && (
          <a className="font-medium text-blue-600 hover:underline" href={`/read/${convId}`}>
            进阅读器 →
          </a>
        )}
      </div>
    </div>
  );
}

function ListView({
  data,
  onSelect,
  selected,
  corpusId,
  conversationIdFor,
}: {
  data: InsightGraphData;
  onSelect: (n: GraphNodeView) => void;
  selected: GraphNodeView | null;
  corpusId: string;
  conversationIdFor?: (node: GraphNodeView) => string | null;
}) {
  void corpusId;
  return (
    <div className="max-h-[560px] space-y-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2">
      {data.nodes.slice(0, 200).map((node) => {
        const meta = (node.metadataJson ?? {}) as { conversationId?: string };
        const convId = conversationIdFor?.(node) ?? meta.conversationId ?? null;
        const isSel = selected?.id === node.id;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              isSel ? 'bg-zinc-100' : 'hover:bg-zinc-50'
            }`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: KIND_COLORS[node.kind] ?? '#9ca3af' }} />
            <span className="flex-1 truncate text-zinc-700">{node.label}</span>
            {convId && <span className="shrink-0 text-[10px] text-blue-500">→</span>}
          </button>
        );
      })}
    </div>
  );
}

function InsightPanel({ insights, corpusId }: { insights: CorpusInsights | null | undefined; corpusId: string }) {
  void corpusId;
  if (!insights) return null;
  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
      <Section title="主题聚类">
        {insights.clusters.length === 0 ? (
          <Muted>无</Muted>
        ) : (
          insights.clusters.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-1 text-sm">
              <span className="truncate text-zinc-700">{c.label}</span>
              <span className="shrink-0 text-xs text-zinc-400">{c.size}</span>
            </div>
          ))
        )}
      </Section>

      <Section title="桥接概念">
        {insights.bridges.length === 0 ? (
          <Muted>无</Muted>
        ) : (
          insights.bridges.map((b) => (
            <div key={b.nodeId} className="py-0.5 text-xs text-zinc-600">
              {b.nodeId.slice(0, 8)}… <span className="text-zinc-400">({b.betweenness.toFixed(2)})</span>
            </div>
          ))
        )}
      </Section>

      <Section title="结构洞">
        {insights.structuralGaps.length === 0 ? (
          <Muted>无</Muted>
        ) : (
          insights.structuralGaps.slice(0, 8).map((g, i) => (
            <div key={i} className="py-0.5 text-xs text-zinc-600">
              主题 {g.clusterA} ↔ 主题 {g.clusterB}
            </div>
          ))
        )}
      </Section>

      <Section title="争议点">
        {insights.controversies.length === 0 ? (
          <Muted>无</Muted>
        ) : (
          insights.controversies.map((c) => (
            <div key={c.nodeId} className="py-0.5 text-xs text-red-500">
              {c.nodeId.slice(0, 8)}… <span className="text-zinc-400">(×{c.contradictCount})</span>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h4>
      <div>{children}</div>
    </div>
  );
}
function Muted({ children }: { children: ReactNode }) {
  return <div className="text-xs text-zinc-400">{children}</div>;
}
