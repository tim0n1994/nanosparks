'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { statusToStage } from '@/lib/progress-stages';
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  BASE_BODY_FONT_PX,
  type ReaderPrefs,
} from '@/lib/reader-prefs';
import type { ChapterAnchor } from '@/lib/reader/chapters';

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
}

type BilingualMode = 'original' | 'translation' | 'sidebyside';

const SPEAKER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

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
}: ReaderShellProps) {
  const [extraTurns, setExtraTurns] = useState<ReaderTurn[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(!hasMoreTurns);
  const [bilingual, setBilingual] = useState<BilingualMode>('original');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Inline speaker rename (PRD §A3): click a speaker name to edit, persists via PATCH.
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Reading display preferences (PRD §A3 移动端优先：字号/行距/暗色).
  // Initialize from localStorage directly (loadPrefs is SSR-safe → returns defaults server-side).
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs());
  const [showPrefs, setShowPrefs] = useState(false);
  // Resume-read prompt (PRD §A3 回访续读提示).
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  // C2 划句高亮: text selection → floating "高亮" button → create highlight via API.
  const [highlightSel, setHighlightSel] = useState<{ turnId: string; x: number; y: number } | null>(null);
  const [highlightSaved, setHighlightSaved] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seek the inline player to a timestamp (called from quote/timestamp clicks).
  const seekTo = useCallback((ms: number) => {
    const audio = document.getElementById('reader-player') as HTMLAudioElement | null;
    if (audio) {
      audio.currentTime = ms / 1000;
      void audio.play().catch(() => {});
    }
  }, []);

  // Scroll to a chapter boundary by turn index (PRD §A3 点击滚动定位).
  const scrollToChapter = useCallback((turnIndex: number) => {
    const all = [...turns, ...extraTurns];
    const t = all.find((x) => x.turnIndex >= turnIndex) ?? all[all.length - 1];
    if (t) {
      const el = document.getElementById(`turn-anchor-${t.turnIndex}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [turns, extraTurns]);

  const allTurns = useMemo(() => [...turns, ...extraTurns], [turns, extraTurns]);

  /** Resolve a speaker label to its display name (inline-edited overrides source). */
  const displayName = useCallback(
    (label: string | null, fallbackName: string | null) =>
      speakerNames[label ?? ''] ?? fallbackName ?? label ?? '未知说话人',
    [speakerNames],
  );

  /** Commit an inline speaker rename via the participant PATCH route. */
  const commitRename = useCallback(
    async (label: string | null) => {
      const newName = renameValue.trim();
      setRenaming(null);
      if (!newName) return;
      // Optimistic local update so the全文 replaces instantly.
      setSpeakerNames((prev) => ({ ...prev, [label ?? '']: newName }));
      // Persist: find the participantId for this label among the turns.
      const turn = allTurns.find((t) => t.participantLabel === label);
      if (turn?.participantId) {
        try {
          await fetch(`/api/conversations/${conversation.id}/participants/${turn.participantId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName }),
          });
        } catch {
          /* best-effort; local state already updated */
        }
      }
    },
    [renameValue, allTurns, conversation.id],
  );

  // Group consecutive turns by speaker into paragraphs for readable layout.
  const paragraphs = useMemo(() => groupBySpeaker(allTurns), [allTurns]);

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
        return;
      }
      const data = await resp.json();
      const next = (data.turns ?? []) as ReaderTurn[];
      if (next.length === 0) {
        setExhausted(true);
      } else {
        setExtraTurns((prev) => [...prev, ...next]);
      }
      if (!data.hasMore) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [conversation.id, allTurns, loadingMore, exhausted]);

  // Persist reading progress (debounced) as the user scrolls.
  const saveProgress = useCallback(
    (scrollRatio: number, turnIndex: number) => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(async () => {
        try {
          await fetch(`/api/conversations/${conversation.id}/read`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnIndex, scrollRatio }),
          });
          setSavedAt(Date.now());
        } catch {
          /* progress save is best-effort */
        }
      }, 1500);
    },
    [conversation.id],
  );

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = height > 0 ? scrolled / height : 0;
      const visibleTurnIndex = nearestTurnIndex(allTurns, scrolled);
      saveProgress(ratio, visibleTurnIndex);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [allTurns, saveProgress]);

  // (seek handling moved into the seekTo callback above)

  const hasTranslation = allTurns.some((t) => t.translationJson);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Trigger on-demand translation (PRD §A3: 按需触发计一次额度).
  const requestTranslation = useCallback(async () => {
    setTranslating(true);
    setTranslateError(null);
    try {
      const resp = await fetch(`/api/conversations/${conversation.id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'zh' }),
      });
      const data = await resp.json();
      if (!data.success) {
        setTranslateError(data.error || '翻译失败');
      } else {
        window.location.reload(); // reflect freshly-written translationJson
      }
    } catch {
      setTranslateError('网络错误');
    } finally {
      setTranslating(false);
    }
  }, [conversation.id]);
  // PRD §A3: play the original enclosure/platform audio, not the page URL.
  const playerUrl = conversation.audioUrl ?? conversation.sourceUrl ?? null;
  // YouTube/Bilibili store the *page* URL as audioUrl — there is no directly
  // playable audio stream, so the native <audio> element can't play it. For
  // those, show an "open original" link instead of a broken player.
  const isStreamableUrl = (url: string | null): boolean => {
    if (!url) return false;
    if (!url.startsWith('http')) return false;
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/')) return false;
    if (lower.includes('bilibili.com/')) return false;
    return true;
  };
  const streamable = isStreamableUrl(playerUrl);
  const [playerError, setPlayerError] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Apply dark mode to the root container + persist prefs on change.
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Fetch saved reading position on mount (PRD §A3 续读提示).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conversations/${conversation.id}/reading-progress`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const idx = data?.progress?.turnIndex;
        // Only prompt if they made real progress past the start.
        if (typeof idx === 'number' && idx > 3 && !data.progress.completedAt) {
          setResumeAt(idx);
        }
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [conversation.id]);

  const updatePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  // C2: detect text selection inside a turn element and show a floating highlight button.
  useEffect(() => {
    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2) { setHighlightSel(null); return; }
      if (!sel) { setHighlightSel(null); return; }
      // Find the enclosing turn-anchor element.
      const anchor = (sel.anchorNode as HTMLElement)?.closest?.('[id^="turn-anchor-"]');
      if (!anchor) { setHighlightSel(null); return; }
      const turnId = anchor.id.replace('turn-anchor-', '');
      // Position the button near the selection.
      const range = sel?.getRangeAt?.(0);
      const rect = range?.getBoundingClientRect();
      if (!rect) { setHighlightSel(null); return; }
      setHighlightSel({ turnId, x: rect.left + rect.width / 2, y: rect.top - 10 });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // Create a highlight from the current text selection.
  const createHighlight = useCallback(async () => {
    if (!highlightSel) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text) return;
    setHighlightSel(null);
    window.getSelection()?.removeAllRanges();
    try {
      await fetch(`/api/conversations/${conversation.id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: highlightSel.turnId, note: text.slice(0, 200) }),
      });
      setHighlightSaved(true);
      setTimeout(() => setHighlightSaved(false), 2000);
    } catch { /* best-effort */ }
  }, [highlightSel, conversation.id]);

  return (
    <div className={prefs.darkMode ? 'min-h-[100dvh] bg-zinc-950 text-zinc-100' : 'min-h-[100dvh] bg-[#fafaf9] text-zinc-900'}>
      {/* Hero */}
      <header className="border-b border-zinc-200/60 bg-white">
        <div className="mx-auto max-w-[680px] px-5 py-8">
          <div className="flex items-start gap-4">
            {conversation.coverUrl ? (
              <img
                src={conversation.coverUrl}
                alt=""
                className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-zinc-100" />
            )}
            <div className="min-w-0">
              {conversation.showTitle && (
                <div className="mb-1 truncate text-[13px] font-medium text-zinc-500">{conversation.showTitle}</div>
              )}
              <h1 className="text-[20px] font-semibold leading-tight tracking-tight">{conversation.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-400">
                {conversation.platformLabel && <span>{conversation.platformLabel}</span>}
                {conversation.durationSec ? (
                  <span className="font-mono tabular-nums">{formatTimestamp(conversation.durationSec * 1000)}</span>
                ) : null}
                {conversation.readCount !== null && conversation.readCount > 1 ? (
                  <span>{conversation.readCount} 人读过</span>
                ) : null}
                {conversation.sourceUrl && (
                  <a
                    href={conversation.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-accent-600 hover:underline"
                  >
                    原链接
                  </a>
                )}
              </div>
            </div>
          </div>

          {!conversation.ready && (() => {
            const stage = statusToStage(conversation.status);
            return (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{stage.label}</span>
                  <span className="text-amber-500">·</span>
                  <span className="text-amber-700">{stage.hint}</span>
                </div>
                <div className="mt-2 h-1 rounded-full bg-amber-100 overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${Math.round(stage.progress * 100)}%` }}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </header>

      {/* Resume-read prompt (PRD §A3 回访续读提示) */}
      {resumeAt !== null && (
        <div className="sticky top-0 z-20 border-b border-accent-200 bg-accent-50">
          <div className="mx-auto flex max-w-[680px] items-center gap-3 px-5 py-2 text-sm">
            <span className="text-accent-800">上次读到第 {resumeAt} 句</span>
            <button
              onClick={() => { scrollToChapter(resumeAt); setResumeAt(null); }}
              className="px-3 py-1 rounded-full rounded-md bg-accent-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-700"
            >
              继续阅读
            </button>
            <button
              onClick={() => setResumeAt(null)}
              className="ml-auto text-[12px] text-accent-400 hover:text-accent-600"
            >
              从头读
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[680px] space-y-8 px-5 py-8">
        {/* TL;DR */}
        {tldr.length > 0 && (
          <section>
            <h2 className="section-label mb-3">
              TL;DR
            </h2>
            <ul className="space-y-2">
              {tldr.map((t) => (
                <li key={t.id} className="flex gap-2.5 text-[15px] leading-[1.7] text-zinc-700">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-500">•</span>
                  <span>{t.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 章节导航 (PRD §A3 sticky, 点击滚动定位) */}
        {chapters.length > 1 && (
          <section className="sticky top-0 z-10 -mx-5 px-5 py-2 backdrop-blur border-b border-zinc-200/60 bg-[#fafaf9]/90">
            <div className="flex gap-2 overflow-x-auto text-[12px] text-zinc-500">
              {chapters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => scrollToChapter(c.turnIndex)}
                  className="whitespace-nowrap rounded-full border border-zinc-200 bg-white px-2.5 py-1 transition-colors hover:border-zinc-400"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 金句墙 */}
        {quotes.length > 0 && (
          <section>
            <h2 className="section-label mb-3">
              金句
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {quotes.map((q) => (
                <button
                  key={q.id}
                  onClick={() => q.timestampMs !== null && seekTo(q.timestampMs)}
                  className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300"
                >
                  <p className="text-[14px] leading-[1.6] text-zinc-700">{q.text}</p>
                  {q.timestampMs !== null && (
                    <span className="mt-2 inline-block font-mono text-[11px] tabular-nums text-zinc-400">
                      {formatTimestamp(q.timestampMs)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Bilingual toggle */}
        {hasTranslation && (
          <section className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-gray-50/90 backdrop-blur border-b border-gray-200">
            <div className="flex items-center gap-1 text-xs">
              {(['original', 'translation', 'sidebyside'] as BilingualMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setBilingual(m)}
                  className={`px-3 py-1 rounded-full transition ${
                    bilingual === m
                      ? 'bg-gray-900 text-white'
                      : 'bg-white border border-gray-200 text-gray-600'
                  }`}
                >
                  {m === 'original' ? '原文' : m === 'translation' ? '译文' : '对照'}
                </button>
              ))}
              {savedAt && <span className="ml-auto text-gray-400">已记录阅读进度</span>}
            </div>
          </section>
        )}

        {/* On-demand translate trigger (PRD §A3: 英文集"翻译本集"按钮) */}
        {!hasTranslation && conversation.status !== 'transcribing' && (
          <section className="-mx-4 px-4 py-2">
            <button
              onClick={requestTranslation}
              disabled={translating}
              className="px-4 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-600 hover:border-gray-400 disabled:opacity-50"
            >
              {translating ? '翻译中…' : '翻译本集（中文）'}
            </button>
            {translateError && <p className="mt-1 text-xs text-red-500">{translateError}</p>}
          </section>
        )}

        {/* Reader display prefs (PRD §A3): font scale / line height / dark mode */}
        <section className="sticky top-0 z-10 -mx-5 px-5 py-2 backdrop-blur border-b border-zinc-200/60 bg-[#fafaf9]/90">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setShowPrefs((s) => !s)}
              className="px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-600"
            >
              Aa
            </button>
            {showPrefs && (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-gray-500">字号</label>
                {FONT_SCALE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updatePrefs({ fontScale: s })}
                    className={`px-2 py-1 rounded ${prefs.fontScale === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200'}`}
                    style={{ fontSize: `${Math.round(BASE_BODY_FONT_PX * s)}px` }}
                  >
                    A
                  </button>
                ))}
                <label className="text-gray-500 ml-2">行距</label>
                {LINE_HEIGHT_OPTIONS.map((l) => (
                  <button
                    key={l}
                    onClick={() => updatePrefs({ lineHeight: l })}
                    className={`px-2 py-1 rounded ${prefs.lineHeight === l ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200'}`}
                  >
                    {l}
                  </button>
                ))}
                <button
                  onClick={() => updatePrefs({ darkMode: !prefs.darkMode })}
                  className={`px-3 py-1 rounded-full ml-2 ${prefs.darkMode ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
                >
                  {prefs.darkMode ? '暗色' : '亮色'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Transcript body */}
        <section className="space-y-4">
          {paragraphs.map((para, i) => {
            const color = colorForLabel(para.speakerLabel);
            return (
              <div key={i} id={`turn-anchor-${para.turns[0]?.turnIndex ?? i}`} className="rounded-lg border border-zinc-200 bg-white p-4 scroll-mt-24">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1 h-4 rounded-full" style={{ backgroundColor: color }} />
                  {renaming === para.speakerLabel ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(para.speakerLabel)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(para.speakerLabel);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="text-[13px] font-medium text-zinc-700 border-b border-gray-300 focus:outline-none focus:border-gray-500 bg-transparent"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setRenaming(para.speakerLabel);
                        setRenameValue(displayName(para.speakerLabel, para.speakerName));
                      }}
                      className="text-[13px] font-medium text-zinc-700 hover:text-gray-900 hover:underline cursor-text"
                      title="点击改名"
                    >
                      {displayName(para.speakerLabel, para.speakerName)}
                    </button>
                  )}
                  <button
                    onClick={() => seekTo(para.startMs)}
                    className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 hover:text-zinc-600"
                  >
                    {formatTimestamp(para.startMs)}
                  </button>
                </div>
                <RenderParagraphText para={para} bilingual={bilingual} prefs={prefs} />
              </div>
            );
          })}
        </section>

        {/* Load more / sentinel */}
        {!exhausted && (
          <div className="flex justify-center py-6">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-600 hover:border-gray-300 disabled:opacity-50"
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}

        {/* Footer */}
        <footer className="pb-12 pt-4 text-center text-[12px] text-zinc-400 space-y-2">
          {/* PRD §A3 导出 MD/Obsidian + 高级入口 */}
          <div className="flex justify-center gap-4">
            <a
              href={`/api/conversations/${conversation.id}/export?format=markdown`}
              className="text-accent-600 hover:underline"
            >
              导出 Markdown
            </a>
            <a
              href={`/api/conversations/${conversation.id}/export?format=json`}
              className="text-accent-600 hover:underline"
            >
              导出 JSON
            </a>
          </div>
          {/* PRD §A3: 图谱/Ask 高级入口（研究功能降级为高级入口） */}
          {conversation.corpusId && (
            <div className="flex justify-center gap-4">
              <Link href={`/corpora/${conversation.corpusId}/graph`} className="text-accent-600 hover:underline">
                知识图谱
              </Link>
              <Link href={`/corpora/${conversation.corpusId}/ask`} className="text-accent-600 hover:underline">
                Ask
              </Link>
            </div>
          )}
          <Link href="/submit" className="underline">
            贴一条新链接
          </Link>
        </footer>
      </main>

      {/* C2 划句高亮: floating button + saved confirmation */}
      {highlightSel && (
        <button
          onClick={createHighlight}
          className="fixed z-30 rounded-md bg-amber-400 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg hover:bg-amber-500"
          style={{ left: Math.min(window.innerWidth - 80, highlightSel.x), top: Math.max(10, highlightSel.y) }}
        >
          高亮
        </button>
      )}
      {highlightSaved && (
        <div className="fixed bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-[12px] text-white">
          已加入高亮库
        </div>
      )}

      {/* Sticky mini player */}
      {playerUrl && (
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200/60 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[680px] items-center gap-3 px-5 py-2">
            <span className="text-[11px] text-zinc-400 flex-shrink-0">原声</span>
            {!streamable ? (
              // Platform page URL (YouTube/Bilibili) — no direct audio stream.
              // Show a link to open the original instead of a broken player.
              <a
                href={playerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                打开原视频 ↗
              </a>
            ) : playerError ? (
              conversation.fallbackAudioUrl && !usingFallback ? (
                <audio
                  id="reader-player"
                  controls
                  className="w-full h-8"
                  preload="none"
                  onError={() => setUsingFallback(true)}
                >
                  <source src={conversation.fallbackAudioUrl} />
                </audio>
              ) : (
                <span className="text-xs text-gray-400">源链接失效，无法播放原声</span>
              )
            ) : (
              <audio
                id="reader-player"
                controls
                className="w-full h-8"
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

function nearestTurnIndex(turns: ReaderTurn[], scrollY: number): number {
  if (turns.length === 0) return 0;
  const el = document.getElementById(`turn-${turns[0].id}`);
  const baseTop = el ? el.getBoundingClientRect().top + window.scrollY : 0;
  // coarse: assume ~80px per turn
  const idx = Math.floor((scrollY - baseTop) / 80);
  return Math.max(0, Math.min(turns.length - 1, idx));
}

function RenderParagraphText({
  para,
  bilingual,
  prefs,
}: {
  para: SpeakerParagraph;
  bilingual: BilingualMode;
  prefs: ReaderPrefs;
}) {
  const fontSize = Math.round(BASE_BODY_FONT_PX * prefs.fontScale);
  const bodyStyle = { fontSize: `${fontSize}px`, lineHeight: prefs.lineHeight };
  if (bilingual === 'sidebyside') {
    return (
      <div className="grid gap-2">
        {para.turns.map((t) => (
          <div key={t.id} className="grid grid-cols-2 gap-3" style={bodyStyle}>
            <p>{t.text}</p>
            <p className="text-gray-500">{firstTranslation(t.translationJson) ?? ''}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1">
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
  const vals = Object.values(json);
  return vals[0];
}
