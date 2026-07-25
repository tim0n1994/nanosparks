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

import { useEffect, useMemo, useState } from 'react';
import KnowledgeGraph3D, { CLUSTER_PALETTE } from './KnowledgeGraph3D';
import { useTranslation } from '@/lib/i18n/useTranslation';
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

/** Legend colours only — the label comes from the i18n catalogue by kind. */
const KIND_LEGEND: { kind: string; color: string }[] = [
  { kind: 'participant', color: '#f87171' },
  { kind: 'entity', color: '#60a5fa' },
  { kind: 'claim_cluster', color: '#a78bfa' },
  { kind: 'topic', color: '#34d399' },
  { kind: 'decision', color: '#fbbf24' },
  { kind: 'open_question', color: '#22d3ee' },
];

export default function GraphExplorer({ corpusId, nodes, edges, insights }: Props) {
  // three.js + d3-force-3d is a frame-rate killer on mid-range Android, and a
  // force-directed cloud is close to unusable with a thumb. Touch devices get
  // the list by default; 3D stays one tap away for anyone who wants it.
  // Resolved after mount so SSR and the first client render agree.
  const { t } = useTranslation();
  const [view, setView] = useState<'3d' | 'list'>('3d');
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView('list');
    }
  }, []);
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
  // Legend entries carry a resolved label so the JSX stays a plain map.
  const legend: { kind: string; label: string; color: string }[] = useMemo(
    () =>
      colorBy === 'kind'
        ? KIND_LEGEND.map((l) => ({ ...l, label: t(`kind.${l.kind}`) }))
        : (insights?.clusters?.slice(0, 6) ?? []).map((c) => ({
            kind: String(c.id),
            label: `${t('kind.topic')} ${c.id + 1}`,
            color: CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length],
          })),
    [colorBy, insights, t],
  );

  const selectedClusterIds = useMemo(() => {
    const ids = new Set<number>();
    for (const c of insights?.clusters ?? []) if ((c.topNodeIds ?? []).includes(selected?.id ?? '')) ids.add(c.id);
    return [...ids];
  }, [insights, selected]);

  return (
    <div
      role="group"
      aria-label={t('graph.title')}
      aria-describedby="graph-text-alternative"
      className="relative h-[70vh] min-h-[520px] w-full overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-overlay-deep to-overlay"
    >
      <p id="graph-text-alternative" className="sr-only">
        {t('graph.textAlternative', { nodes: nodes.length, edges: edges.length })}
      </p>
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
        <div className="pointer-events-auto flex w-64 items-center gap-1.5 rounded-xl border border-white/10 bg-overlay/80 px-2.5 py-1.5 backdrop-blur">
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('graph.searchNodes')}
            className="w-full bg-transparent text-sm text-overlay-ink placeholder:text-overlay-ink-muted outline-none"
          />
        </div>
        <div className="pointer-events-auto inline-flex rounded-lg border border-white/10 bg-overlay/80 p-0.5 text-2xs backdrop-blur">
          <div role="radiogroup" aria-label={t('graph.view')} className="inline-flex">
            <Seg group="view" value="3d" active={view === '3d'} onClick={() => setView('3d')}>3D</Seg>
            <Seg group="view" value="list" active={view === 'list'} onClick={() => setView('list')}>{t('graph.list')}</Seg>
          </div>
          <span aria-hidden="true" className="mx-0.5 w-px self-stretch bg-overlay-ink/10" />
          <div role="radiogroup" aria-label={t('graph.colorBy')} className="inline-flex">
            <Seg group="color" value="kind" active={colorBy === 'kind'} onClick={() => setColorBy('kind')}>{t('graph.byKind')}</Seg>
            <Seg group="color" value="cluster" active={colorBy === 'cluster'} onClick={() => setColorBy('cluster')}>{t('graph.byCluster')}</Seg>
          </div>
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
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-overlay/70 px-2.5 py-1.5 backdrop-blur">
        {legend.map((item) => (
          <span key={item.kind} className="flex items-center gap-1 text-2xs text-overlay-ink-muted">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {/* ── Bottom-center: node detail popover ── */}
      {selected && (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 w-[min(92%,440px)] -translate-x-1/2 rounded-xl border border-white/10 bg-overlay/92 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-wide text-overlay-ink-muted">{selected.kind}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-overlay-ink-muted hover:text-overlay-ink" aria-label={t('common.close')}>×</button>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-overlay-ink">{selected.canonicalText ?? selected.label}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-overlay-ink-muted">
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

function Seg({
  active,
  onClick,
  children,
  group,
  value,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  group: string;
  value: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      data-group={group}
      data-value={value}
      onClick={onClick}
      className={`rounded-md px-2 py-1 transition ${active ? 'bg-overlay-ink text-overlay-deep' : 'text-overlay-ink-muted hover:text-overlay-ink'}`}
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-overlay-ink-muted">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ListView({ nodes, onSelect, selected }: { nodes: ExplorerNode[]; onSelect: (n: ExplorerNode) => void; selected: ExplorerNode | null }) {
  return (
    <div className="h-full overflow-y-auto bg-overlay/40 p-2">
      <div className="mx-auto max-w-md space-y-1">
        {nodes.slice(0, 200).map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${selected?.id === n.id ? 'bg-overlay-ink/10' : 'hover:bg-overlay-ink/5'}`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: (KIND_LEGEND.find((k) => k.kind === n.kind)?.color ?? '#9ca3af') }} />
            <span className="flex-1 truncate text-overlay-ink">{n.label}</span>
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  void corpusId;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute right-3 top-3 rounded-lg border border-white/10 bg-overlay/80 px-2.5 py-1.5 text-2xs text-overlay-ink-muted backdrop-blur hover:text-overlay-ink"
      >
        {t('insight.title')} →
      </button>
    );
  }
  return (
    <div className="pointer-events-auto absolute right-3 top-3 flex max-h-[calc(70vh-24px)] w-64 flex-col overflow-hidden rounded-xl border border-white/10 bg-overlay/85 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-overlay-ink-muted">{t('insight.title')}</span>
        <button type="button" onClick={() => setOpen(false)} className="text-overlay-ink-muted hover:text-overlay-ink" aria-label={t('common.close')}>×</button>
      </div>
      <div className="space-y-3 overflow-y-auto p-3 text-overlay-ink-muted">
        <InsightSection title={t('insight.clusters')}>
          {insights.clusters?.length ? insights.clusters.map((c) => (
            <div key={c.id} className={`flex items-center justify-between py-0.5 text-xs ${clusterIds.includes(c.id) ? 'text-amber-300' : ''}`}>
              <span className="truncate">{t('kind.topic')} {c.id + 1}</span>
              <span className="text-2xs text-overlay-ink-muted">{t('graph.nodes', { count: c.topNodeIds?.length ?? 0 })}</span>
            </div>
          )) : <Muted>{t('insight.none')}</Muted>}
        </InsightSection>
        <InsightSection title={t('insight.bridges')}>
          {insights.bridges?.length ? insights.bridges.slice(0, 6).map((b) => (
            <div key={b.nodeId} className="py-0.5 text-2xs text-overlay-ink-muted">
              {t('insight.betweenness', { value: b.betweenness.toFixed(2) })}
            </div>
          )) : <Muted>{t('insight.none')}</Muted>}
        </InsightSection>
        <InsightSection title={t('insight.gaps')}>
          {insights.structuralGaps?.length ? insights.structuralGaps.slice(0, 6).map((g, i) => (
            <div key={i} className="py-0.5 text-2xs text-overlay-ink-muted">{t('kind.topic')} {g.clusterA + 1} ↔ {t('kind.topic')} {g.clusterB + 1}</div>
          )) : <Muted>{t('insight.none')}</Muted>}
        </InsightSection>
        <InsightSection title={t('insight.controversies')}>
          {insights.controversies?.length ? insights.controversies.slice(0, 6).map((c) => (
            <div key={c.nodeId} className="py-0.5 text-2xs text-rose-400">×{c.contradictCount} 反驳</div>
          )) : <Muted>{t('insight.none')}</Muted>}
        </InsightSection>
      </div>
    </div>
  );
}

function InsightSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-overlay-ink-muted">{title}</h4>
      <div>{children}</div>
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-2xs text-ink-subtle">{children}</div>;
}
