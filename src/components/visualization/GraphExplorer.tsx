'use client';

/**
 * V2.1 图谱探索器：全屏沉浸式 3D 知识图谱 + 浮层控制台。
 *
 * 主画面是 KnowledgeGraph3D（three.js 力导向，满屏可旋转）。浮层 UI 不嵌套
 * 卡片，而是定位在四角的轻量面板（搜索/染色/图例/洞察/证据卡），与 3D 场景
 * 共存。WebGL 不可用时退化为可键盘导航的列表视图（移动端等价物）。
 *
 * 设计取舍：洞察面板（聚类/桥接/结构洞/争议）从 2D 版本完整继承——3D 是
 * 视觉招牌，洞察面板给结论而非让用户自己盯。两者互补。
 */

import { useMemo, useState } from 'react';
import KnowledgeGraph3D, { CLUSTER_PALETTE } from './KnowledgeGraph3D';
import type { Graph3DData } from './KnowledgeGraph3D';

interface ExplorerNode {
  id: string;
  kind: string;
  label: string;
  canonicalText?: string | null;
  metadataJson?: unknown;
}
interface ExplorerEdge {
  id: string;
  relation: string;
  confidence: number;
  sourceNode: { id: string; label: string; kind: string };
  targetNode: { id: string; label: string; kind: string };
}

interface Props {
  corpusId: string;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  insights: Graph3DData['insights'];
}

const KIND_LEGEND: { kind: string; label: string; color: string }[] = [
  { kind: 'participant', label: '说话人', color: '#f87171' },
  { kind: 'entity', label: '实体', color: '#60a5fa' },
  { kind: 'claim_cluster', label: '主张', color: '#a78bfa' },
  { kind: 'topic', label: '主题', color: '#34d399' },
  { kind: 'decision', label: '决定', color: '#fbbf24' },
  { kind: 'open_question', label: '待解', color: '#22d3ee' },
];

export default function GraphExplorer({ corpusId, nodes, edges, insights }: Props) {
  const [view, setView] = useState<'3d' | 'list'>('3d');
  const [colorBy, setColorBy] = useState<'kind' | 'cluster'>('kind');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ExplorerNode | null>(null);

  const data: Graph3DData = useMemo(
    () => ({ nodes, edges, insights }),
    [nodes, edges, insights],
  );

  const meta = (selected?.metadataJson ?? {}) as {
    conversationId?: string;
    speakerName?: string;
    stance?: string;
    type?: string;
  };
  const convId = meta.conversationId ?? null;
  const selectedClusterIds = useMemo(() => {
    const ids = new Set<number>();
    for (const c of insights?.clusters ?? []) if ((c.topNodeIds ?? []).includes(selected?.id ?? '')) ids.add(c.id);
    return [...ids];
  }, [insights, selected]);

  return (
    <div className="relative h-[70vh] min-h-[520px] w-full overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-950 to-zinc-900">
      {/* 3D scene or list fallback */}
      {view === '3d' ? (
        <KnowledgeGraph3D
          data={data}
          highlight={search}
          colorBy={colorBy}
          onSelectNode={(n) => setSelected(n as ExplorerNode | null)}
        />
      ) : (
        <ListView nodes={nodes} onSelect={setSelected} selected={selected} />
      )}

      {/* ── Top-left: search + view/colorBy controls ── */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
        <div className="pointer-events-auto flex w-64 items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/80 px-2.5 py-1.5 backdrop-blur">
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点…"
            className="w-full bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
        </div>
        <div className="pointer-events-auto inline-flex rounded-lg border border-white/10 bg-zinc-900/80 p-0.5 text-[11px] backdrop-blur">
          <Seg active={view === '3d'} onClick={() => setView('3d')}>3D</Seg>
          <Seg active={view === 'list'} onClick={() => setView('list')}>列表</Seg>
          <span className="mx-0.5 w-px self-stretch bg-white/10" />
          <Seg active={colorBy === 'kind'} onClick={() => setColorBy('kind')}>按类型</Seg>
          <Seg active={colorBy === 'cluster'} onClick={() => setColorBy('cluster')}>按聚类</Seg>
        </div>
      </div>

      {/* ── Top-right: insight panel (collapsible) ── */}
      {insights && (
        <InsightDeck
          insights={insights}
          clusterIds={selectedClusterIds}
          corpusId={corpusId}
        />
      )}

      {/* ── Bottom-left: legend ── */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-zinc-900/70 px-2.5 py-1.5 backdrop-blur">
        {(colorBy === 'kind' ? KIND_LEGEND : insights?.clusters?.slice(0, 6).map((c) => ({ kind: String(c.id), label: `主题 ${c.id + 1}`, color: CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length] })) ?? []).map((item) => (
          <span key={item.kind} className="flex items-center gap-1 text-[10px] text-zinc-300">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* ── Bottom-center: node detail popover ── */}
      {selected && (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 w-[min(92%,440px)] -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-900/92 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{selected.kind}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-200" aria-label="关闭">×</button>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-100">{selected.canonicalText ?? selected.label}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
            {meta.speakerName && <span>· {meta.speakerName}</span>}
            {meta.stance && <span>· {meta.stance}</span>}
            <a className="font-medium text-sky-400 hover:underline" href={`/corpora/${corpusId}/ask?q=${encodeURIComponent(selected.canonicalText ?? selected.label)}`}>
              以此提问 →
            </a>
            {convId && (
              <a className="font-medium text-sky-400 hover:underline" href={`/read/${convId}`}>
                进阅读器 →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 transition ${active ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'}`}
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-400">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ListView({ nodes, onSelect, selected }: { nodes: ExplorerNode[]; onSelect: (n: ExplorerNode) => void; selected: ExplorerNode | null }) {
  return (
    <div className="h-full overflow-y-auto bg-zinc-950/40 p-2">
      <div className="mx-auto max-w-md space-y-1">
        {nodes.slice(0, 200).map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] ${selected?.id === n.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: (KIND_LEGEND.find((k) => k.kind === n.kind)?.color ?? '#9ca3af') }} />
            <span className="flex-1 truncate text-zinc-200">{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InsightDeck({
  insights,
  clusterIds,
  corpusId,
}: {
  insights: NonNullable<Graph3DData['insights']>;
  clusterIds: number[];
  corpusId: string;
}) {
  const [open, setOpen] = useState(true);
  void corpusId;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute right-3 top-3 rounded-lg border border-white/10 bg-zinc-900/80 px-2.5 py-1.5 text-[11px] text-zinc-300 backdrop-blur hover:text-zinc-100"
      >
        结构洞察 →
      </button>
    );
  }
  return (
    <div className="pointer-events-auto absolute right-3 top-3 flex max-h-[calc(70vh-24px)] w-64 flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-900/85 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">结构洞察</span>
        <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="收起">×</button>
      </div>
      <div className="space-y-3 overflow-y-auto p-3 text-zinc-300">
        <InsightSection title="主题聚类">
          {insights.clusters?.length ? insights.clusters.map((c) => (
            <div key={c.id} className={`flex items-center justify-between py-0.5 text-[12px] ${clusterIds.includes(c.id) ? 'text-amber-300' : ''}`}>
              <span className="truncate">主题 {c.id + 1}</span>
              <span className="text-[10px] text-zinc-500">{c.topNodeIds?.length ?? 0} 节点</span>
            </div>
          )) : <Muted>暂无</Muted>}
        </InsightSection>
        <InsightSection title="桥接概念">
          {insights.bridges?.length ? insights.bridges.slice(0, 6).map((b) => (
            <div key={b.nodeId} className="py-0.5 text-[11px] text-zinc-400">
              介数 {b.betweenness.toFixed(2)}
            </div>
          )) : <Muted>暂无</Muted>}
        </InsightSection>
        <InsightSection title="结构洞">
          {insights.structuralGaps?.length ? insights.structuralGaps.slice(0, 6).map((g, i) => (
            <div key={i} className="py-0.5 text-[11px] text-zinc-400">主题 {g.clusterA + 1} ↔ 主题 {g.clusterB + 1}</div>
          )) : <Muted>暂无</Muted>}
        </InsightSection>
        <InsightSection title="争议点">
          {insights.controversies?.length ? insights.controversies.slice(0, 6).map((c) => (
            <div key={c.nodeId} className="py-0.5 text-[11px] text-rose-400">×{c.contradictCount} 反驳</div>
          )) : <Muted>暂无</Muted>}
        </InsightSection>
      </div>
    </div>
  );
}

function InsightSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      <div>{children}</div>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-zinc-600">{children}</div>;
}
