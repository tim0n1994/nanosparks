'use client';

/**
 * V2.1 知识图谱 3D 主画面（three.js / 3d-force-graph）。
 *
 * 取代 2D sigma 视图作为图谱页的视觉招牌：全屏沉浸式 3D 力导向图，
 * 节点按类型/聚类着色、大小按 betweenness，contradicts 边带流动粒子，
 * 相机可轨道旋转/缩放。点击节点 → onSelectNode 回调（浮层证据卡）。
 *
 * 选型：3d-force-graph（vasturiano）= three.js + d3-force-3d 的成熟封装，
 * 是 3D 知识图谱的事实标准（万级节点、内置力布局、轨道控制、悬停标签）。
 * 这是「最先进且可靠」的选择，而非手搓 R3F 力模拟。
 *
 * 力布局在客户端跑（3D 力导向的本质），与 2D 的服务端 ForceAtlas2 预计算
 * 互不干扰：后者继续喂 L1 列表视图 + 洞察计算（聚类/介数/结构洞）。
 *
 * 懒加载：在浏览器 + WebGL 可用时才 import，避免 SSR/jsdom 崩溃。
 */

import { useEffect, useRef, useState } from 'react';

// Cluster palette — shared with the overlay legend.
export const CLUSTER_PALETTE = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#fb7185', '#22d3ee', '#fb923c', '#4ade80', '#e879f9',
];
const KIND_COLOR: Record<string, string> = {
  participant: '#f87171',
  entity: '#60a5fa',
  claim_cluster: '#a78bfa',
  topic: '#34d399',
  decision: '#fbbf24',
  open_question: '#22d3ee',
  concept: '#f472b6',
};

type GNode = {
  id: string;
  kind: string;
  label: string;
  canonicalText?: string | null;
  metadataJson?: unknown;
};
type GEdge = {
  id: string;
  relation: string;
  confidence: number;
  sourceNode: { id: string };
  targetNode: { id: string };
};

export interface Graph3DData {
  nodes: GNode[];
  edges: GEdge[];
  insights?: {
    clusters?: { id: number; label?: string; topNodeIds?: string[]; size?: number }[];
    bridges?: { nodeId: string; betweenness: number }[];
    structuralGaps?: { clusterA: number; clusterB: number }[];
    controversies?: { nodeId: string; contradictCount: number }[];
  } | null;
}

interface Props {
  data: Graph3DData;
  /** search term → highlight matching nodes + fly camera to first match */
  highlight?: string;
  colorBy: 'kind' | 'cluster';
  onSelectNode: (n: GNode | null) => void;
}

// Map of node id → cluster id (derived from insight cluster membership).
function buildClusterMap(data: Graph3DData): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of data.insights?.clusters ?? []) {
    for (const id of c.topNodeIds ?? []) m.set(id, c.id);
  }
  return m;
}

function nodeColor(
  node: GNode & { __cluster?: number },
  colorBy: 'kind' | 'cluster',
): string {
  if (colorBy === 'cluster' && node.__cluster != null) {
    return CLUSTER_PALETTE[node.__cluster % CLUSTER_PALETTE.length];
  }
  return KIND_COLOR[node.kind] ?? '#9ca3af';
}

export default function KnowledgeGraph3D({ data, highlight, colorBy, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  // Build once per data/colorBy change.
  useEffect(() => {
    if (!containerRef.current || data.nodes.length === 0) return;

    // Feature-detect WebGL before importing the (heavy) graph engine.
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) {
      setWebglFailed(true);
      return;
    }

    let cancelled = false;
    const container = containerRef.current;

    (async () => {
      const ForceGraph3DModule = await import('3d-force-graph');
      // The published .d.ts types declare the default export as a single-arg
      // constructor, but the runtime is a Kapsule factory: it must be called
      // twice — `ForceGraph3D()(element)` — to mount into the DOM. Cast to the
      // real double-call shape so typing stays honest.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type Graph3DInstance = any;
      const ForceGraph3D = (ForceGraph3DModule as unknown as {
        default: () => (el: HTMLElement) => Graph3DInstance;
      }).default;

      if (cancelled || !container) return;

      const clusterMap = buildClusterMap(data);
      const betweenness = new Map<string, number>();
      for (const b of data.insights?.bridges ?? []) betweenness.set(b.nodeId, b.betweenness);

      const graphData = {
        nodes: data.nodes.map((n) => ({
          id: n.id,
          name: n.label,
          // size ∝ betweenness (1..12), min 3
          val: 3 + Math.min(9, (betweenness.get(n.id) ?? 0) * 60),
          kind: n.kind,
          __cluster: clusterMap.get(n.id),
          color: nodeColor({ ...n, __cluster: clusterMap.get(n.id) }, colorBy),
          __raw: n,
        })),
        links: data.edges
          .filter((e) => e.sourceNode.id !== e.targetNode.id)
          .map((e) => ({
            source: e.sourceNode.id,
            target: e.targetNode.id,
            relation: e.relation,
            color: e.relation === 'contradicts' ? '#f87171' : 'rgba(148,163,184,0.35)',
          })),
      };

      // Kapsule pattern: ForceGraph3D()(element) — the first call returns the
      // component function, the second mounts it into the DOM element.
      const g: Graph3DInstance = ForceGraph3D()(container)
        .graphData(graphData)
        .backgroundColor('rgba(0,0,0,0)')
        .nodeRelSize(3.5)
        .nodeOpacity(0.95)
        .nodeLabel((n: { name?: string }) => `<div style="max-width:260px;padding:6px 8px;border-radius:6px;background:rgba(17,24,39,.92);color:#e5e7eb;font:12px/1.5 system-ui">${escapeHtml((n as { name?: string }).name ?? '')}</div>`)
        .nodeColor((n: { color?: string }) => n.color ?? '#9ca3af')
        .nodeAutoColorBy(null as unknown as string)
        .linkColor((l: { color?: string }) => l.color ?? 'rgba(148,163,184,0.35)')
        .linkWidth((l: { relation?: string }) => (l.relation === 'contradicts' ? 1.4 : 0.5))
        .linkDirectionalParticles((l: { relation?: string }) => (l.relation === 'contradicts' ? 3 : 0))
        .linkDirectionalParticleWidth(1.2)
        .linkDirectionalParticleColor(() => '#fca5a5')
        .linkOpacity(0.5)
        .showNavInfo(false)
        .cooldownTicks(120)
        .warmupTicks(40)
        .onNodeClick((node: { __raw?: GNode; id?: string }) => {
          onSelectNode(node.__raw ?? null);
        })
        .onBackgroundClick(() => onSelectNode(null));

      // Tune the 3D force for nicer spacing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d3Force = (g as any).d3Force?.bind(g);
      if (d3Force) {
        const charge = d3Force('charge');
        if (charge) charge.strength(-90);
        const link = d3Force('link');
        if (link) link.distance(38);
      }

      // Size to container.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resize = () => (g as any).width(container.clientWidth).height(container.clientHeight);
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      graphRef.current = g;
    })().catch(() => {
      if (!cancelled) setWebglFailed(true);
    });

    return () => {
      cancelled = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (graphRef.current as any)?._destructor?.();
      } catch {
        /* ignore */
      }
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colorBy]);

  // Search: highlight + fly-to first match (separate effect to avoid re-sim).
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const q = (highlight ?? '').trim().toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gd = (g as any).graphData() as { nodes: { id: string; name?: string; color?: string; x?: number; y?: number; z?: number; __raw?: GNode }[] };
    if (!gd?.nodes) return;
    if (!q) {
      // restore colors
      const clusterMap = buildClusterMap(data);
      for (const n of gd.nodes) {
        n.color = nodeColor({ ...(n.__raw ?? { id: n.id, kind: 'concept', label: n.name ?? '' }), __cluster: clusterMap.get(n.id) }, colorBy);
      }
      (g as unknown as { nodeRelSize: (n: number) => unknown }).nodeRelSize(3.5);
    } else {
      let first: { x?: number; y?: number; z?: number } | null = null;
      for (const n of gd.nodes) {
        const match = (n.name ?? '').toLowerCase().includes(q);
        n.color = match ? '#fde047' : 'rgba(148,163,184,0.25)';
        if (match && !first) first = n;
      }
      if (first) {
        (g as unknown as { cameraPosition: (p: { x: number; y: number; z: number }, l: { x: number; y: number; z: number }, ms: number) => unknown }).cameraPosition(
          { x: (first.x ?? 0), y: (first.y ?? 0), z: (first.z ?? 0) + 140 },
          { x: first.x ?? 0, y: first.y ?? 0, z: first.z ?? 0 },
          600,
        );
      }
    }
    (g as unknown as { refresh: () => unknown }).refresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, colorBy]);

  if (webglFailed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-zinc-400">
        你的设备不支持 WebGL，已切换为列表视图。
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
