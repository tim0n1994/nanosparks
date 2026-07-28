'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { statusToStage } from '@/lib/progress-stages';
import {
  loadPrefs,
  savePrefs,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  BASE_BODY_FONT_PX,
  type ReaderPrefs,
} from '@/lib/reader-prefs';
import type { ChapterAnchor } from '@/lib/reader/chapters';

import Navbar from '@/components/ui/Navbar';
import CoverImage from '@/components/ui/CoverImage';
import Button from '@/components/ui/Button';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Popover from '@/components/ui/Popover';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import ReaderStructurePanel from '@/components/reader/ReaderStructurePanel';
import ProcessingPanel from '@/components/reader/ProcessingPanel';
import HighlightLibrary from '@/components/reader/HighlightLibrary';
import { useProgressStream } from '@/lib/reader/useProgressStream';

export interface ReaderConversation {
  id: string;
  title: string;
  status: string;
  ready: boolean;
  language?: string;
  platform: string | null;
  platformLabel: string | null;
  sourceUrl: string | null;
  coverUrl: string | null;
  showTitle: string | null;
  durationSec: number | null;
  readCount: number | null;
  /** Enclosure/platform audio URL for the inline player (PRD §A3). */
  audioUrl: string | null;
  fallbackAudioUrl?: string | null;
  /** Corpus id for the graph/Ask advanced-entry links (PRD §A3 底部). */
  corpusId?: string | null;
}

export interface ReaderParticipant {
  id: string;
  name: string;
  speakerLabel: string | null;
  role: string | null;
}

export interface ReaderTurn {
  id: string;
  turnIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  translationJson: Record<string, string> | null;
  participantId?: string | null;
  participantName: string | null;
  participantLabel: string | null;
}

interface ReaderShellProps {
  conversation: ReaderConversation;
  chapters?: ChapterAnchor[];
  participants: ReaderParticipant[];
  tldr: { id: string; type: string; text: string }[];
  quotes: { id: string; text: string; timestampMs: number | null }[];
  turns: ReaderTurn[];
  hasMoreTurns: boolean;
  /** Publish/share controls, rendered inside the reading column. */
  publishSlot?: ReactNode;
}

type BilingualMode = 'original' | 'translation' | 'sidebyside';

const SPEAKER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const PROGRESS_SAVE_DEBOUNCE_MS = 1500;
/** Above this many paragraphs we stop auto-loading and require an explicit tap. */
const AUTOLOAD_PARAGRAPH_CEILING = 600;

function colorForLabel(label: string | null): string {
  if (!label) return '#6b7280';
  const n = parseInt(label.replace(/\D/g, '') || '0', 10);
  return SPEAKER_COLORS[n % SPEAKER_COLORS.length];
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function ReaderShell({
  conversation,
  chapters = [],
  participants,
  tldr,
  quotes,
  turns,
  hasMoreTurns,
  publishSlot,
}: ReaderShellProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [extraTurns, setExtraTurns] = useState<ReaderTurn[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(!hasMoreTurns);
  const [bilingual, setBilingual] = useState<BilingualMode>('original');
  // Inline speaker rename (PRD §A3): click a speaker name to edit, persists via PATCH.
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Reading display preferences (PRD §A3 移动端优先：字号/行距/暗色).
  // Server render always uses defaults; the real values are read in an effect so
  // SSR and the first client render agree. The dark class itself is applied
  // pre-paint by the inline script in layout.tsx, so there is no flash.
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs());
  // C2 划句高亮: text selection → floating "高亮" button → create highlight via API.
  const [highlightSel, setHighlightSel] = useState<{ turnId: string; x: number; y: number } | null>(null);
  const [highlightVersion, setHighlightVersion] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deduped + ordered. While a conversation is still transcribing we stream
  // turns in client-side, and a later router.refresh() re-sends the first page
  // from the server — without this the overlap renders twice.
  const allTurns = useMemo(() => {
    const byId = new Map<string, ReaderTurn>();
    for (const t of turns) byId.set(t.id, t);
    for (const t of extraTurns) byId.set(t.id, t);
    return [...byId.values()].sort((a, b) => a.turnIndex - b.turnIndex);
  }, [turns, extraTurns]);
  const paragraphs = useMemo(() => groupBySpeaker(allTurns), [allTurns]);

  // ── Progressive delivery (PRD §3.3) ────────────────────────────────────
  // The reader subscribes to the pipeline itself rather than relying on the
  // submit form staying mounted, so progress survives a refresh, a
  // backgrounded tab, or landing here straight from a shared link.
  const progress = useProgressStream(
    conversation.ready ? null : conversation.id,
    // Fresh TL;DR / quotes / chapters only exist server-side.
    useCallback(() => router.refresh(), [router]),
  );
  const fallbackStage = useMemo(() => statusToStage(conversation.status), [conversation.status]);
  const [retrying, setRetrying] = useState(false);

  const reprocess = useCallback(async () => {
    setRetrying(true);
    try {
      const resp = await fetch(`/api/conversations/${conversation.id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      router.refresh();
    } catch {
      toast(t('processing.retryFailed'), 'error');
    } finally {
      setRetrying(false);
    }
  }, [conversation.id, router, toast, t]);

  // Seek the inline player to a timestamp (called from quote/timestamp clicks).
  const seekTo = useCallback((ms: number) => {
    const audio = document.getElementById('reader-player') as HTMLAudioElement | null;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play().catch(() => {});
  }, []);

  /** Scroll to the paragraph containing a turn index (PRD §A3 点击滚动定位). */
  const scrollToTurn = useCallback(
    (turnIndex: number) => {
      const target =
        paragraphs.find((p) => (p.turns[0]?.turnIndex ?? 0) >= turnIndex) ??
        paragraphs[paragraphs.length - 1];
      if (!target) return;
      document
        .getElementById(`turn-anchor-${target.turns[0]?.turnIndex ?? 0}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [paragraphs],
  );
  const scrollToTurnRef = useRef(scrollToTurn);
  useEffect(() => {
    scrollToTurnRef.current = scrollToTurn;
  }, [scrollToTurn]);

  /**
   * Resolve a speaker label to its display name (inline-edited overrides source).
   * Uses `||` deliberately: diarization emits empty-string labels, which `??`
   * happily passes through and renders as a nameless, unclickable blank.
   */
  const displayName = useCallback(
    (label: string | null, fallbackName: string | null) =>
      speakerNames[speakerKey(label)] || fallbackName || label || t('reader.unknownSpeaker'),
    [speakerNames, t],
  );

  /** Commit an inline speaker rename via the participant PATCH route. */
  const commitRename = useCallback(
    async (label: string | null, previous: string) => {
      const newName = renameValue.trim();
      setRenaming(null);
      if (!newName || newName === previous) return;
      const key = speakerKey(label);
      // Optimistic: the whole transcript re-labels instantly.
      setSpeakerNames((prev) => ({ ...prev, [key]: newName }));
      const turn = allTurns.find((t) => t.participantLabel === label);
      if (!turn?.participantId) return;
      try {
        const resp = await fetch(
          `/api/conversations/${conversation.id}/participants/${turn.participantId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
          },
        );
        if (!resp.ok) throw new Error(String(resp.status));
      } catch {
        // Roll the optimistic edit back and say so — a silent revert reads as a bug.
        setSpeakerNames((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toast(t('reader.renameFailed'), 'error');
      }
    },
    [renameValue, allTurns, conversation.id, toast, t],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const last = allTurns[allTurns.length - 1];
      const resp = await fetch(
        `/api/conversations/${conversation.id}/turns?limit=200&cursor=${last?.id ?? ''}`,
      );
      if (!resp.ok) {
        setExhausted(true);
        toast(t('reader.loadMoreFailed'), 'error');
        return;
      }
      const data = await resp.json();
      const next = (data.turns ?? []) as ReaderTurn[];
      if (next.length === 0) setExhausted(true);
      else setExtraTurns((prev) => [...prev, ...next]);
      if (!data.hasMore) setExhausted(true);
    } catch {
      toast(t('common.networkError'), 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [conversation.id, allTurns, loadingMore, exhausted, toast, t]);

  /** Persist reading progress (debounced). */
  const saveProgress = useCallback(
    (scrollRatio: number, turnIndex: number) => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => {
        void fetch(`/api/conversations/${conversation.id}/read`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnIndex, scrollRatio }),
        }).catch(() => {
          /* progress save is best-effort; the reader keeps working offline */
        });
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
    [conversation.id],
  );

  // Track the topmost visible paragraph with IntersectionObserver instead of
  // measuring on every scroll event — no per-frame getBoundingClientRect, and it
  // reports the *actual* turn index rather than the old 80px-per-turn guess.
  useEffect(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>('[data-turn-index]'),
    );
    if (anchors.length === 0) return;
    let topMost = Infinity;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset.turnIndex);
          if (Number.isFinite(idx)) topMost = Math.min(topMost, idx);
        }
        if (topMost === Infinity) return;
        const height = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = height > 0 ? window.scrollY / height : 0;
        saveProgress(ratio, topMost);
        topMost = Infinity;
      },
      { rootMargin: '-10% 0px -80% 0px' },
    );
    anchors.forEach((a) => observer.observe(a));
    return () => observer.disconnect();
  }, [paragraphs.length, saveProgress]);

  // While transcription is running, pull the newly-written segments in as they
  // land so the wait is progressive: text appears from ~2min instead of the
  // whole article arriving at ~10min. Keyed on the SSE turn count so we only
  // fetch when the worker has actually produced something new.
  const streamedCount = progress.detail?.turnCount ?? 0;
  useEffect(() => {
    if (conversation.ready || streamedCount <= allTurns.length) return;
    let cancelled = false;
    const last = allTurns[allTurns.length - 1];
    fetch(`/api/conversations/${conversation.id}/turns?limit=200&cursor=${last?.id ?? ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const next = (data.turns ?? []) as ReaderTurn[];
        if (next.length > 0) setExtraTurns((prev) => [...prev, ...next]);
      })
      .catch(() => {
        /* best-effort; the next heartbeat retries */
      });
    return () => {
      cancelled = true;
    };
  }, [streamedCount, allTurns, conversation.id, conversation.ready]);

  // Auto-load the next page when the sentinel scrolls into view, up to a ceiling
  // where an explicit tap is better than an unbounded DOM.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted || paragraphs.length > AUTOLOAD_PARAGRAPH_CEILING) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [exhausted, loadMore, paragraphs.length]);

  const hasTranslation = allTurns.some((t) => t.translationJson);
  const [translating, setTranslating] = useState(false);

  // Trigger on-demand translation (PRD §A3: 按需触发计一次额度).
  const requestTranslation = useCallback(async () => {
    setTranslating(true);
    try {
      const resp = await fetch(`/api/conversations/${conversation.id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'zh' }),
      });
      const data = await resp.json();
      if (!data.success) {
        toast(data.error || t('reader.translateFailed'), 'error');
        return;
      }
      toast(t('reader.translateDone'), 'success');
      // Refresh server data in place — a full reload would lose scroll position.
      router.refresh();
    } catch {
      toast(t('common.networkError'), 'error');
    } finally {
      setTranslating(false);
    }
  }, [conversation.id, router, toast, t]);

  // PRD §A3: play the original enclosure/platform audio, not the page URL.
  const playerUrl = conversation.audioUrl ?? conversation.sourceUrl ?? null;
  // YouTube/Bilibili store the *page* URL as audioUrl — there is no directly
  // playable audio stream, so the native <audio> element can't play it. For
  // those, show an "open original" link instead of a broken player.
  const isStreamableUrl = (url: string | null): boolean => {
    if (!url || !url.startsWith('http')) return false;
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/')) return false;
    if (lower.includes('bilibili.com/')) return false;
    return true;
  };
  const streamable = isStreamableUrl(playerUrl);
  const [playerError, setPlayerError] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Re-read stored prefs after mount so SSR and the first client render agree.
  // This is a deliberate one-shot hydration read, not derived state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPrefs(loadPrefs()), []);

  // Persist prefs + keep the document theme attribute in sync with the toggle.
  useEffect(() => {
    savePrefs(prefs);
    document.documentElement.setAttribute('data-theme', prefs.darkMode ? 'dark' : 'light');
  }, [prefs]);

  // Resume-read prompt (PRD §A3 回访续读提示). A one-shot toast with an action
  // rather than a banner: the old sticky/inline card cost a permanent row at
  // the top of every revisit, for a prompt the user answers once.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/conversations/${conversation.id}/reading-progress`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const idx = data?.progress?.turnIndex;
        // Only prompt if they made real progress past the start.
        if (typeof idx !== 'number' || idx <= 3 || data.progress.completedAt) return;
        toast(t('reader.resume', { index: idx }), {
          action: { label: t('reader.resumeAction'), onClick: () => scrollToTurnRef.current(idx) },
        });
      })
      .catch(() => {
        /* best-effort */
      });
    return () => controller.abort();
  }, [conversation.id, toast, t]);

  const updatePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  // C2: detect a text selection inside a turn and offer to highlight it.
  // `selectionchange` covers touch selection on iOS/Android, which the old
  // mouseup-only listener missed entirely.
  useEffect(() => {
    let raf = 0;
    const evaluate = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!sel || !text || text.length < 2) {
        setHighlightSel(null);
        return;
      }
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const anchor = el?.closest<HTMLElement>('[data-turn-id]');
      if (!anchor?.dataset.turnId) {
        setHighlightSel(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setHighlightSel(null);
        return;
      }
      // Clamp here, where `window` is legitimately available — reading a ref
      // during render to do this is a React rules violation and breaks SSR.
      const centre = rect.left + rect.width / 2;
      setHighlightSel({
        turnId: anchor.dataset.turnId,
        x: Math.min(Math.max(48, centre), Math.max(48, window.innerWidth - 48)),
        y: Math.max(56, rect.top - 10),
      });
    };
    const onSelectionChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(evaluate);
    };
    // Scrolling invalidates the fixed-position button — drop it rather than
    // leaving it stranded over unrelated text.
    const onScroll = () => setHighlightSel(null);
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  /** Create a highlight from the current text selection. */
  const createHighlight = useCallback(async () => {
    if (!highlightSel) return;
    const text = window.getSelection()?.toString().trim() ?? '';
    if (!text) return;
    setHighlightSel(null);
    window.getSelection()?.removeAllRanges();
    try {
      const resp = await fetch(`/api/conversations/${conversation.id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: highlightSel.turnId, note: text.slice(0, 200) }),
      });
      toast(t('reader.highlightSaved'), 'success');
      setHighlightVersion((v) => v + 1);
    } catch {
      toast(t('reader.highlightFailed'), 'error');
    }
  }, [highlightSel, conversation.id, toast, t]);

  const fontSize = Math.round(BASE_BODY_FONT_PX * prefs.fontScale);

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <Navbar />

      {/* Hero */}
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto max-w-reading px-5 py-8">
          <div className="flex items-start gap-4">
            <CoverImage src={conversation.coverUrl} size={64} priority className="h-16 w-16" />
            <div className="min-w-0">
              {conversation.showTitle && (
                <div className="mb-1 truncate text-sm font-medium text-ink-muted">
                  {conversation.showTitle}
                </div>
              )}
              <h1 className="text-xl font-semibold leading-tight tracking-tight text-balance">
                {conversation.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                {conversation.platformLabel && <span>{conversation.platformLabel}</span>}
                {conversation.durationSec ? (
                  <span className="font-mono tabular-nums">
                    {formatTimestamp(conversation.durationSec * 1000)}
                  </span>
                ) : null}
                {conversation.readCount !== null && conversation.readCount > 1 ? (
                  <span>{t('reader.readCount', { count: conversation.readCount })}</span>
                ) : null}
                {conversation.sourceUrl && (
                  <a
                    href={conversation.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-link hover:underline"
                  >
                    {t('reader.sourceLink')}
                  </a>
                )}
              </div>
            </div>
          </div>

          {!conversation.ready && (
            <ProcessingPanel
              detail={progress.detail}
              stage={progress.stage ?? fallbackStage.stage}
              stalled={progress.stalled}
              fallbackProgress={fallbackStage.progress}
              onRetry={reprocess}
              retrying={retrying}
            />
          )}
        </div>
      </header>

      {/* One toolbar. Previously four separate `sticky top-0` bars stacked on
          top of each other and ate most of a phone viewport. */}
      <div className="sticky top-13 z-20 border-b border-line bg-surface/90 backdrop-blur">
        {/* Single 44px row: chapters and display settings are popovers, so
            opening either never pushes the transcript down or steals a second
            row on a phone. */}
        <div className="mx-auto flex h-11 max-w-reading items-center gap-2 px-5">
          {chapters.length > 1 && (
            <Popover
              triggerLabel={t('reader.chapterNav')}
              align="start"
              panelClassName="max-h-[60vh] w-56 overflow-y-auto"
              trigger={
                <>
                  {t('reader.chapters')}
                  <span aria-hidden="true" className="text-2xs opacity-60">▾</span>
                </>
              }
            >
              <ul>
                {chapters.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-popover-close
                      onClick={() => scrollToTurn(c.turnIndex)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-ink-subtle hover:bg-surface-sunken hover:text-ink"
                    >
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </Popover>
          )}

          {hasTranslation && (
            <SegmentedControl
              label={t('reader.bilingual')}
              value={bilingual}
              onChange={setBilingual}
              className="flex-shrink-0"
              options={[
                { value: 'original', label: t('reader.original') },
                { value: 'translation', label: t('reader.translation') },
                { value: 'sidebyside', label: t('reader.sideBySide') },
              ]}
            />
          )}

          <Popover
            triggerLabel={t('reader.displaySettings')}
            align="end"
            className="ml-auto"
            panelClassName="w-64 space-y-3 p-3"
            trigger="Aa"
          >
            <PrefRow label={t('reader.fontSize')}>
              <SegmentedControl
                label={t('reader.fontSize')}
                value={String(prefs.fontScale)}
                onChange={(v) => updatePrefs({ fontScale: Number(v) })}
                options={FONT_SCALE_OPTIONS.map((s) => ({
                  value: String(s),
                  label: 'A',
                  srLabel: t('reader.fontSizeOption', { px: Math.round(BASE_BODY_FONT_PX * s) }),
                  style: { fontSize: `${Math.round(BASE_BODY_FONT_PX * s * 0.85)}px` },
                }))}
              />
            </PrefRow>
            <PrefRow label={t('reader.lineHeight')}>
              <SegmentedControl
                label={t('reader.lineHeight')}
                value={String(prefs.lineHeight)}
                onChange={(v) => updatePrefs({ lineHeight: Number(v) })}
                options={LINE_HEIGHT_OPTIONS.map((l) => ({
                  value: String(l),
                  label: String(l),
                  srLabel: t('reader.lineHeightOption', { value: l }),
                }))}
              />
            </PrefRow>
            <PrefRow label={t('reader.theme')}>
              <SegmentedControl
                label={t('reader.theme')}
                value={prefs.darkMode ? 'dark' : 'light'}
                onChange={(v) => updatePrefs({ darkMode: v === 'dark' })}
                options={[
                  { value: 'light', label: t('reader.light') },
                  { value: 'dark', label: t('reader.dark') },
                ]}
              />
            </PrefRow>
          </Popover>
        </div>
      </div>

      <main id="main" className={cn('mx-auto max-w-reading space-y-8 px-5 py-8', playerUrl && 'pb-player')}>
        {/* TL;DR */}
        {tldr.length > 0 && (
          <section aria-labelledby="tldr-heading">
            <h2 id="tldr-heading" className="section-label mb-3">
              {t('reader.tldr')}
            </h2>
            <ul className="space-y-2">
              {tldr.map((t) => (
                <li key={t.id} className="flex gap-2.5 text-base text-ink-subtle">
                  <span
                    aria-hidden="true"
                    className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-500"
                  />
                  <span>{t.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* V1/T-V1-3: 结构 — speaker swimlanes / topic flow / argument tree */}
        <ReaderStructurePanel
          conversationId={conversation.id}
          participants={participants}
          turns={turns}
          durationMs={conversation.durationSec ? conversation.durationSec * 1000 : null}
          onSeek={seekTo}
        />

        {/* 金句墙 */}
        {quotes.length > 0 && (
          <section aria-labelledby="quotes-heading">
            <h2 id="quotes-heading" className="section-label mb-3">
              {t('reader.quotes')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {quotes.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => q.timestampMs !== null && seekTo(q.timestampMs)}
                  disabled={q.timestampMs === null}
                  className="rounded-xl border border-line bg-surface-raised p-4 text-left transition-colors hover:border-ink-muted disabled:cursor-default"
                >
                  <p className="text-sm leading-relaxed text-ink-subtle">{q.text}</p>
                  {q.timestampMs !== null && (
                    <span className="ts-pill mt-2 inline-block">
                      {formatTimestamp(q.timestampMs)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* On-demand translate trigger (PRD §A3: 英文集"翻译本集"按钮) */}
        {!hasTranslation && conversation.status !== 'transcribing' && (
          <Button variant="secondary" onClick={requestTranslation} loading={translating}>
            {translating ? t('reader.translating') : t('reader.translate')}
          </Button>
        )}

        {/* Transcript body */}
        <section aria-label={t('reader.transcript')} className="space-y-4">
          {paragraphs.map((para, i) => {
            const color = colorForLabel(para.speakerLabel);
            const turnIndex = para.turns[0]?.turnIndex ?? i;
            const name = displayName(para.speakerLabel, para.speakerName);
            return (
              <article
                key={turnIndex}
                id={`turn-anchor-${turnIndex}`}
                data-turn-index={turnIndex}
                data-turn-id={para.turns[0]?.id}
                className="defer-paint scroll-mt-28 rounded-xl border border-line bg-surface-raised p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-1 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {renaming === speakerKey(para.speakerLabel) ? (
                    <input
                      autoFocus
                      value={renameValue}
                      aria-label={t('reader.renameLabel')}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(para.speakerLabel, name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(para.speakerLabel, name);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="border-b border-line bg-transparent text-sm font-medium text-ink focus:border-accent-500 focus:outline-none focus-visible:ring-0"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(speakerKey(para.speakerLabel));
                        setRenameValue(name);
                      }}
                      title={t('reader.renameHint')}
                      aria-label={t('reader.renameAria', { name })}
                      className="rounded text-sm font-medium text-ink-subtle decoration-dotted underline-offset-4 hover:text-ink hover:underline"
                    >
                      {name}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => seekTo(para.startMs)}
                    aria-label={t('reader.playFrom', { time: formatTimestamp(para.startMs) })}
                    className="ts-pill ml-auto hover:text-ink"
                  >
                    {formatTimestamp(para.startMs)}
                  </button>
                </div>
                <ParagraphText
                  para={para}
                  bilingual={bilingual}
                  fontSize={fontSize}
                  lineHeight={prefs.lineHeight}
                />
              </article>
            );
          })}
        </section>

        {/* Auto-load sentinel + explicit fallback past the ceiling */}
        {!exhausted && (
          <div ref={sentinelRef} className="flex justify-center py-6">
            <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </Button>
          </div>
       )}

        {/* Keyed wrapper: publishSlot is a ReactNode (from ReadPage); when it
            renders alongside the paragraphs.map() output above, React treats it
            as a list sibling and requires a key. */}
        {publishSlot ? <div key="publish-slot">{publishSlot}</div> : null}

       {/* 下一步 (PRD §3.1). Reaching the end of an episode used to be a dead
            end — four text links in a footer. This is the actual continuation:
            keep reading, go deeper, or start the loop again. */}
        {conversation.ready && (
          <section aria-labelledby="next-heading" className="border-t border-line pt-6">
            <h2 id="next-heading" className="section-label mb-3">
              {t('reader.nextTitle')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <NextStepCard
                href="/submit"
                title={t('reader.next.another')}
                hint={t('reader.next.anotherHint')}
              />
              {conversation.corpusId ? (
                <NextStepCard
                  href={`/corpora/${conversation.corpusId}/graph`}
                  title={t('reader.next.graph')}
                  hint={t('reader.next.graphHint')}
                />
              ) : (
                <NextStepCard href="/dashboard" title={t('reader.next.shelf')} hint={t('reader.next.shelfHint')} />
              )}
              {conversation.corpusId && (
                <NextStepCard
                  href={`/corpora/${conversation.corpusId}/ask`}
                  title={t('reader.next.ask')}
                  hint={t('reader.next.askHint')}
                />
              )}
              <NextStepCard href="/dashboard" title={t('reader.next.shelf')} hint={t('reader.next.shelfHint')} />
            </div>
          </section>
        )}
        <HighlightLibrary
          conversationId={conversation.id}
          refreshKey={highlightVersion}
          onJump={(turnId) => {
            const el = document.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-sm">
          <span className="text-xs text-ink-muted">{t('common.export')}</span>
          <a
            href={`/api/conversations/${conversation.id}/export?format=markdown`}
            className="text-link hover:underline"
          >
            Markdown
          </a>
          <a
            href={`/api/conversations/${conversation.id}/export?format=json`}
            className="text-link hover:underline"
          >
            JSON
          </a>
        </footer>
      </main>

      {/* C2 划句高亮 floating action */}
      {highlightSel && (
        <button
          type="button"
          onClick={createHighlight}
          className="fixed z-30 -translate-x-1/2 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-amber-600"
          style={{ left: highlightSel.x, top: highlightSel.y }}
        >
          {t('reader.highlight')}
        </button>
      )}

      {/* Sticky mini player */}
      {playerUrl && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-raised/95 backdrop-blur-xl inset-safe-bottom">
          <div className="mx-auto flex max-w-reading items-center gap-3 px-5 py-2">
            <span className="flex-shrink-0 text-2xs text-ink-muted">{t('reader.audio')}</span>
            {!streamable ? (
              // Platform page URL (YouTube/Bilibili) — no direct audio stream.
              <a
                href={playerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-link hover:underline"
              >
                {t('reader.openOriginal')}
              </a>
            ) : playerError ? (
              conversation.fallbackAudioUrl && !usingFallback ? (
                <audio
                  id="reader-player"
                  controls
                  className="h-8 w-full"
                  preload="none"
                  onError={() => setUsingFallback(true)}
                >
                  <source src={conversation.fallbackAudioUrl} />
                </audio>
              ) : (
                <span className="text-xs text-ink-muted">{t('reader.audioDead')}</span>
              )
            ) : (
              <audio
                id="reader-player"
                controls
                className="h-8 w-full"
                preload="none"
                onError={() => setPlayerError(true)}
              >
                {playerUrl.startsWith('http') && <source src={playerUrl} />}
              </audio>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A stable, never-null key for a speaker label. Diarization emits null and ''
 * for unlabeled speakers; comparing those directly against the `renaming`
 * state (also initialised to null) made every unlabeled paragraph render its
 * rename input permanently.
 */
function speakerKey(label: string | null): string {
  return label && label.length > 0 ? label : '__unlabeled__';
}

/** A continuation the reader can take when they reach the end of an episode. */
function NextStepCard({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-ink-muted"
    >
      <span className="block text-sm font-medium text-ink group-hover:text-link">{title}</span>
      <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
    </Link>
  );
}

/** One labelled row inside the display-settings popover. */
function PrefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

interface SpeakerParagraph {
  speakerLabel: string | null;
  speakerName: string | null;
  startMs: number;
  turns: ReaderTurn[];
}

/** Group consecutive turns by speaker into readable paragraphs. */
function groupBySpeaker(turns: ReaderTurn[]): SpeakerParagraph[] {
  const out: SpeakerParagraph[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.speakerLabel === (t.participantLabel ?? null)) {
      last.turns.push(t);
    } else {
      out.push({
        speakerLabel: t.participantLabel ?? null,
        speakerName: t.participantName ?? null,
        startMs: t.startMs,
        turns: [t],
      });
    }
  }
  return out;
}

function ParagraphText({
  para,
  bilingual,
  fontSize,
  lineHeight,
}: {
  para: SpeakerParagraph;
  bilingual: BilingualMode;
  fontSize: number;
  lineHeight: number;
}) {
  const bodyStyle = { fontSize: `${fontSize}px`, lineHeight };

  if (bilingual === 'sidebyside') {
    return (
      <div className="grid gap-2">
        {para.turns.map((t) => (
          // Stacks on phones — a two-column split at 375px is unreadable.
          <div key={t.id} className="grid gap-1 sm:grid-cols-2 sm:gap-3" style={bodyStyle}>
            <p>{t.text}</p>
            <p className="text-ink-muted">{firstTranslation(t.translationJson) ?? ''}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="reading-text space-y-1">
      {para.turns.map((t) => (
        <p key={t.id} style={bodyStyle}>
          {bilingual === 'translation' ? (firstTranslation(t.translationJson) ?? t.text) : t.text}
        </p>
      ))}
    </div>
  );
}

function firstTranslation(json: Record<string, string> | null): string | undefined {
  if (!json) return undefined;
  return Object.values(json)[0];
}
