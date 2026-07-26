'use client';

/**
 * V1/T-V1-3: reader L0 structural visualizations.
 *
 * Three views, all seek-linked to the inline player via onSeek(ms):
 *   - Speakers: horizontal swimlanes, one per participant, blocks = turns
 *   - Topic flow: thought-unit type distribution across time windows
 *   - Arguments: claim/assert roots with temporally-following objections, stance-colored
 *
 * Data: participants + turns come from the reader (already in hand); thought
 * units are fetched on first expand from /api/conversations/:id/thought-units.
 * Rendered with positioned divs (percentage math) rather than canvas so click
 * hit-testing and mobile scroll are trivial for single-episode data volumes.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ReaderParticipant, ReaderTurn } from '@/components/reader/ReaderShell';

const SPEAKER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const STANCE_COLORS: Record<string, string> = {
  assert: '#3b82f6',
  oppose: '#ef4444',
  question: '#f59e0b',
  concede: '#10b981',
  neutral: '#9ca3af',
};
const TYPE_COLORS: Record<string, string> = {
  claim: '#3b82f6',
  insight: '#8b5cf6',
  evidence: '#10b981',
  objection: '#ef4444',
  decision: '#f59e0b',
  risk: '#f97316',
  question: '#06b6d4',
};

interface ThoughtUnitView {
  id: string;
  type: string;
  text: string;
  stance: string | null;
  participantId: string | null;
  startMs: number | null;
  endMs: number | null;
  turnId: string | null;
}

interface Props {
  conversationId: string;
  participants: ReaderParticipant[];
  turns: ReaderTurn[];
  durationMs: number | null;
  onSeek: (ms: number) => void;
}

type Tab = 'lanes' | 'river' | 'args';

function colorForParticipant(idx: number): string {
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function ReaderStructurePanel({ conversationId, participants, turns, durationMs, onSeek }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('lanes');
  const [tus, setTus] = useState<ThoughtUnitView[]>([]);
  const [loading, setLoading] = useState(false);

  const duration = useMemo(() => {
    if (durationMs && durationMs > 0) return durationMs;
    const max = turns.reduce((m, tr) => Math.max(m, tr.endMs), 0);
    return max || 1;
  }, [durationMs, turns]);

  // Fetch thought units lazily on first expand (keeps the cold reader cheap).
  useEffect(() => {
    if (!expanded || tus.length > 0 || loading) return;
    // Lazy fetch on first expand; the rest of the state lands in callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/conversations/${conversationId}/thought-units`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setTus(Array.isArray(j.data) ? (j.data as ThoughtUnitView[]) : []))
      .catch(() => setTus([]))
      .finally(() => setLoading(false));
  }, [expanded, conversationId, tus.length, loading]);

  const participantName = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return t('viz.noData');
      const p = participants.find((pp) => pp.id === id);
      return p?.name ?? '?';
    },
    [participants, t],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'lanes', label: t('viz.speakerLanes') },
    { id: 'river', label: t('viz.topicRiver') },
    { id: 'args', label: t('viz.argumentTree') },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface-raised">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="section-label">{t('viz.structure')}</span>
        <span className="text-xs text-ink-muted">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="border-t border-line-soft px-4 pb-4 pt-3">
          {/* Tab switch */}
          <div className="mb-3 flex gap-1 rounded-lg bg-surface-sunken p-1">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  tab === tb.id ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink-subtle'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>
          <p className="mb-3 text-2xs text-ink-muted">{t('viz.seekHint')}</p>

          {tab === 'lanes' && <SpeakerLanes participants={participants} turns={turns} duration={duration} onSeek={onSeek} />}
          {tab === 'river' && <TopicRiver tus={tus} duration={duration} onSeek={onSeek} loading={loading} />}
          {tab === 'args' && <ArgumentTree tus={tus} participantName={participantName} onSeek={onSeek} loading={loading} />}
        </div>
      )}
    </section>
  );
}

// ─── Speaker swimlanes ──────────────────────────────────────────

function SpeakerLanes({
  participants,
  turns,
  duration,
  onSeek,
}: {
  participants: ReaderParticipant[];
  turns: ReaderTurn[];
  duration: number;
  onSeek: (ms: number) => void;
}) {
  // Build lanes keyed by participantId (null → "unknown" lane).
  const lanes = useMemo(() => {
    const order = new Map<string | null, { id: string | null; name: string; idx: number }>();
    participants.forEach((p, i) => order.set(p.id, { id: p.id, name: p.name, idx: i }));
    const grouped = new Map<string | null, ReaderTurn[]>();
    for (const tr of turns) {
      const key = tr.participantId ?? null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tr);
      if (!order.has(key)) order.set(key, { id: null, name: tr.participantName ?? tr.participantLabel ?? '?', idx: order.size });
    }
    return [...order.values()].map((lane) => ({
      ...lane,
      turns: grouped.get(lane.id) ?? [],
      total: (grouped.get(lane.id) ?? []).reduce((s, tr) => s + (tr.endMs - tr.startMs), 0),
    }));
  }, [participants, turns]);

  if (lanes.every((l) => l.turns.length === 0)) {
    return <EmptyHint />;
  }

  return (
    <div className="space-y-2.5">
      {lanes.map((lane) => (
        <div key={lane.idx} className="flex items-center gap-2">
          <div className="w-20 flex-shrink-0 truncate text-xs font-medium text-ink-subtle" title={lane.name}>
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{ backgroundColor: colorForParticipant(lane.idx) }}
            />
            {lane.name}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-sunken">
            {lane.turns.map((tr) => {
              const left = (tr.startMs / duration) * 100;
              const width = Math.max(0.4, ((tr.endMs - tr.startMs) / duration) * 100);
              return (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => onSeek(tr.startMs)}
                  title={`${lane.name} · ${fmt(tr.startMs)}`}
                  className="absolute top-0 h-full rounded-sm hover:opacity-80"
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: colorForParticipant(lane.idx) }}
                />
              );
            })}
          </div>
          <div className="w-10 flex-shrink-0 text-right text-2xs tabular-nums text-ink-muted">{fmt(lane.total)}</div>
        </div>
      ))}
      <TimeRuler duration={duration} />
    </div>
  );
}

// ─── Topic flow (TU type distribution across time windows) ───────

const RIVER_WINDOWS = 24;
const RIVER_TYPES = ['claim', 'insight', 'evidence', 'objection', 'decision', 'risk', 'question'];

function TopicRiver({
  tus,
  duration,
  onSeek,
  loading,
}: {
  tus: ThoughtUnitView[];
  duration: number;
  onSeek: (ms: number) => void;
  loading: boolean;
}) {
  const windows = useMemo(() => {
    const buckets = Array.from({ length: RIVER_WINDOWS }, () => new Map<string, ThoughtUnitView[]>());
    for (const tu of tus) {
      const ms = tu.startMs ?? 0;
      const i = Math.min(RIVER_WINDOWS - 1, Math.floor((ms / duration) * RIVER_WINDOWS));
      const type = RIVER_TYPES.includes(tu.type) ? tu.type : 'insight';
      if (!buckets[i].has(type)) buckets[i].set(type, []);
      buckets[i].get(type)!.push(tu);
    }
    return buckets;
  }, [tus, duration]);

  if (loading) return <div className="py-6 text-center text-xs text-ink-muted">…</div>;
  if (tus.length === 0) return <EmptyHint />;

  return (
    <div>
      <div className="flex h-24 items-end gap-px">
        {windows.map((bucket, i) => {
          const startMs = (i / RIVER_WINDOWS) * duration;
          const total = [...bucket.values()].reduce((s, arr) => s + arr.length, 0);
          if (total === 0) return <div key={i} className="flex-1" />;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeek(startMs)}
              title={`${fmt(startMs)} · ${total}`}
              className="flex flex-1 flex-col-reverse justify-start overflow-hidden rounded-sm hover:opacity-80"
            >
              {RIVER_TYPES.filter((ty) => bucket.has(ty)).map((ty) => {
                const count = bucket.get(ty)!.length;
                return (
                  <div
                    key={ty}
                    style={{ backgroundColor: TYPE_COLORS[ty], height: `${Math.max(8, count * 14)}px` }}
                    title={ty}
                  />
                );
              })}
            </button>
          );
        })}
      </div>
      <TimeRuler duration={duration} />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {RIVER_TYPES.map((ty) => (
          <span key={ty} className="flex items-center gap-1 text-2xs text-ink-muted">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: TYPE_COLORS[ty] }} />
            {ty}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Argument tree (claims + temporally-following objections) ────

function ArgumentTree({
  tus,
  participantName,
  onSeek,
  loading,
}: {
  tus: ThoughtUnitView[];
  participantName: (id: string | null | undefined) => string;
  onSeek: (ms: number) => void;
  loading: boolean;
}) {
  const roots = useMemo(() => {
    const claimLike = tus.filter((tu) => tu.type === 'claim' || tu.type === 'insight' || tu.stance === 'assert');
    const objections = tus.filter((tu) => tu.type === 'objection' || tu.stance === 'oppose');
    const sorted = [...claimLike].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    return sorted.map((root) => {
      const rootMs = root.startMs ?? 0;
      // Attach objections that follow within 5 minutes (same heuristic as graph builder step 6).
      const children = objections
        .filter((o) => (o.startMs ?? 0) >= rootMs && (o.startMs ?? 0) <= rootMs + 5 * 60 * 1000)
        .slice(0, 4);
      return { root, children };
    });
  }, [tus]);

  if (loading) return <div className="py-6 text-center text-xs text-ink-muted">…</div>;
  if (roots.length === 0) return <EmptyHint />;

  return (
    <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
      {roots.slice(0, 30).map(({ root, children }) => {
        const stance = root.stance ?? 'assert';
        return (
          <div key={root.id} className="rounded-lg border border-line-soft bg-surface-sunken/60 p-2.5">
            <button
              type="button"
              onClick={() => root.startMs != null && onSeek(root.startMs)}
              className="block w-full text-left"
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: STANCE_COLORS[stance] ?? '#3b82f6' }} />
                <span className="text-sm leading-relaxed text-ink">{root.text}</span>
              </div>
              <div className="mt-1 pl-4 text-2xs text-ink-muted">
                {participantName(root.participantId)} {root.startMs != null && `· ${fmt(root.startMs)}`}
              </div>
            </button>
            {children.length > 0 && (
              <div className="mt-2 ml-4 space-y-1.5 border-l-2 border-line pl-3">
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => c.startMs != null && onSeek(c.startMs)}
                    className="block w-full text-left"
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                      <span className="text-xs leading-relaxed text-ink-subtle">{c.text}</span>
                    </div>
                    <div className="pl-3.5 text-2xs text-ink-muted">
                      {participantName(c.participantId)} {c.startMs != null && `· ${fmt(c.startMs)}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── shared bits ────────────────────────────────────────────────

function TimeRuler({ duration }: { duration: number }) {
  const ticks = 5;
  return (
    <div className="mt-1 flex justify-between pl-22 pr-10 text-2xs tabular-nums text-ink-muted">
      {Array.from({ length: ticks }, (_, i) => (
        <span key={i}>{fmt((i / (ticks - 1)) * duration)}</span>
      ))}
    </div>
  );
}

function EmptyHint() {
  const { t } = useTranslation();
  return <div className="py-6 text-center text-xs text-ink-muted">{t('viz.noData')}</div>;
}
