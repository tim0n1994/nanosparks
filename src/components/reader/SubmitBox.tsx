'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Field from '@/components/ui/Field';
import StatusBadge from '@/components/ui/StatusBadge';
import CoverImage from '@/components/ui/CoverImage';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { INFLIGHT_KEY } from '@/lib/reader/useProgressStream';

/**
 * True when `input` looks like a URL the ingest pipeline can handle (has a
 * scheme + host). Anything else is treated as a podcast show name → discover.
 * Accepts schemeless hosts like "open.spotify.com/..." by testing for a dot in
 * the first segment, but rejects bare words / sentences.
 */
function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // schemeless "host/path" — needs a dot in the host part and no spaces
  if (/\s/.test(s)) return false;
  const firstSeg = s.split('/')[0];
  return firstSeg.includes('.') && firstSeg.length <= 100;
}
interface IngestResponse {
  success: boolean;
  conversationId?: string;
  cached?: boolean;
  title?: string;
  multiEpisode?: boolean;
  showTitle?: string;
  coverUrl?: string;
  episodes?: Array<{
    episodeKey: string;
    platform: string;
    title: string;
    description?: string;
    durationSec?: number;
    coverUrl?: string;
    audioUrl?: string;
  }>;
  error?: string;
  kind?: string;
  platform?: string;
}

/** Failure kinds that have an actionable hint in the catalogue. */
const ERROR_KINDS = new Set([
  'concurrent',
  'not_found',
  'spotify_exclusive',
  'login_required',
  'region_restricted',
  'no_audio',
  'quota_exhausted',
  'unsupported',
]);

const BATCH_POLL_MS = 4000;
const BATCH_POLL_MAX_MS = 30_000;
const BATCH_POLL_MAX_ERRORS = 5;

export default function SubmitBox() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResponse | null>(null);
  // Discover-by-name fallback (used when the platform link can't be fetched,
  // e.g. Spotify exclusive/timeout — user types the show name, we find RSS).
  const [discoverName, setDiscoverName] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // ── Batch ingest state ──
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    episodes: Array<{ id: string; title: string; status: string; ready: boolean }>;
    total: number;
    completed: number;
    failed: number;
    skippedQuota: number;
    done: boolean;
  } | null>(null);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * PRD §3.3 progressive delivery: a single episode goes straight to its reader
   * page, which owns the SSE subscription. Keeping the user on a checklist here
   * meant a refresh lost all progress, and it duplicated the reader's own
   * processing UI.
   */
  const enterReader = useCallback(
    (conversationId: string) => {
      sessionStorage.setItem(INFLIGHT_KEY, conversationId);
      router.push(`/read/${conversationId}`);
    },
    [router],
  );

  // If a previous submit is still in flight, offer the way back to it.
  const [inflightId, setInflightId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInflightId(sessionStorage.getItem(INFLIGHT_KEY));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    const trimmed = url.trim();
    if (!trimmed) return;

    // Smart input: a URL → ingest; anything else (a show name) → discover its
    // RSS via iTunes and list episodes. One box handles both.
    if (!looksLikeUrl(trimmed)) {
      await handleDiscoverByName(trimmed);
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, mode: 'robot' }),
      });
      const data = (await resp.json()) as IngestResponse;
      if (!data.success) {
        setError(data.error || t('submit.failed'));
        setResult(data);
      } else if (data.conversationId && !data.multiEpisode) {
        // Cached or fresh — both land in the reader. A fresh one shows the
        // hero + live progress and fills in as the worker writes turns.
        if (data.cached) router.push(`/read/${data.conversationId}`);
        else enterReader(data.conversationId);
      } else {
        setResult(data);
      }
    } catch {
      setError(t('common.networkError'));
    } finally {
      setLoading(false);
    }
  };

  // ── Batch ingest helpers ──

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const all = result?.episodes?.map((e) => e.episodeKey) ?? [];
    setSelectedKeys((prev) => (prev.size === all.length ? new Set() : new Set(all)));
  };

  /** Poll batch status with exponential backoff so a failing endpoint is not
   *  hammered every 4s forever. */
  const pollBatch = useCallback(
    (ids: string[]) => {
      if (batchTimer.current) clearTimeout(batchTimer.current);
      let delay = BATCH_POLL_MS;
      let consecutiveErrors = 0;

      const tick = async () => {
        try {
          const resp = await fetch(`/api/conversations/batch-status?ids=${ids.join(',')}`);
          const data = await resp.json();
          if (!data.success) throw new Error('batch-status failed');
          consecutiveErrors = 0;
          delay = BATCH_POLL_MS;
          setBatchProgress((prev) =>
            prev
              ? {
                  ...prev,
                  episodes: data.episodes,
                  total: data.total,
                  completed: data.completed,
                  failed: data.failed,
                  done: data.done,
                }
              : prev,
          );
          if (data.done) return;
        } catch {
          consecutiveErrors += 1;
          delay = Math.min(delay * 2, BATCH_POLL_MAX_MS);
          if (consecutiveErrors >= BATCH_POLL_MAX_ERRORS) {
            toast(t('submit.batch.pollFailed'), 'error');
            return;
          }
        }
        batchTimer.current = setTimeout(tick, delay);
      };

      void tick();
    },
    [toast, t],
  );

  const handleBatchIngest = async () => {
    if (!result?.episodes || selectedKeys.size === 0) return;
    setBatchLoading(true);
    setError('');
    try {
      const selected = result.episodes.filter((e) => selectedKeys.has(e.episodeKey));
      const resp = await fetch('/api/ingest/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          episodes: selected.map((e) => ({
            episodeKey: e.episodeKey,
            audioUrl: e.audioUrl || e.episodeKey,
            sourceUrl: url,
            platform: e.platform,
            title: e.title,
            durationSec: e.durationSec,
          })),
          mode: 'robot',
        }),
      });
      const data = await resp.json();
      if (!data.success) {
        setError(data.error || t('submit.batch.failedSubmit'));
        return;
      }
      const enqueued: Array<{ id: string; title: string; status: string; ready: boolean }> = (
        data.enqueued ?? []
      ).map((e: { conversationId: string; title: string; cached: boolean }) => ({
        id: e.conversationId,
        title: e.title,
        status: e.cached ? 'completed' : 'pending',
        ready: e.cached,
      }));
      setBatchProgress({
        episodes: enqueued,
        total: enqueued.length,
        completed: enqueued.filter((e) => e.ready).length,
        failed: 0,
        skippedQuota: data.skippedQuota ?? 0,
        done: enqueued.length === 0,
      });
      const pollIds = enqueued.filter((e) => !e.ready).map((e) => e.id);
      if (pollIds.length > 0) pollBatch(pollIds);
      setResult(null);
      setSelectedKeys(new Set());
    } catch {
      setError(t('common.networkError'));
    } finally {
      setBatchLoading(false);
    }
  };

  // Clean up the batch poller on unmount.
  useEffect(() => () => { if (batchTimer.current) clearTimeout(batchTimer.current); }, []);

  // Discover a show's RSS by name (fallback when the platform link failed).
  // Hits /api/discover/feed → iTunes + LLM arbitration → RSS parse → episode list.
  const handleDiscoverByName = async (overrideName?: string) => {
    const name = (overrideName ?? discoverName).trim();
    if (!name || loading || discoverLoading) return;
    // From the main box we reuse `loading`; from the fallback box, discoverLoading.
    const viaMainBox = overrideName !== undefined;
    if (viaMainBox) setLoading(true); else setDiscoverLoading(true);
    setError('');
    try {
      const r = await fetch('/api/discover/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) {
        setError(data.error || '未找到该节目的 RSS');
        setResult(null);
        return;
      }
      // Reuse the multi-episode picker with the discovered list.
      setResult({
        success: true,
        multiEpisode: true,
        showTitle: data.data.showTitle,
        coverUrl: data.data.coverUrl ?? undefined,
        episodes: data.data.episodes.map((e: Record<string, unknown>) => ({
          episodeKey: e.episodeKey as string,
          platform: 'rss',
          title: e.title as string,
          description: e.description as string | undefined,
          durationSec: e.durationSec as number | undefined,
          coverUrl: e.coverUrl as string | undefined,
          audioUrl: e.audioUrl as string | undefined,
        })),
      });
    } catch {
      setError(t('common.networkError'));
    } finally {
      if (viaMainBox) setLoading(false); else setDiscoverLoading(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <form onSubmit={handleSubmit}>
        <Field
          label={t('submit.urlLabel')}
          labelHidden
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('submit.placeholder')}
          autoFocus
          disabled={loading}
          error={error || null}
          trailing={
            <Button
              type="submit"
              size="sm"
              loading={loading}
              disabled={!url.trim()}
              className="m-1 shrink-0"
            >
              {loading ? t('submit.submitting') : t('submit.go')}
            </Button>
          }
        />
      </form>

      {/* Actionable follow-up for a failed submit */}
      {error && (result?.conversationId || result?.kind) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          {result?.kind && ERROR_KINDS.has(result.kind) && <p>{t(`ingest.err.${result.kind}`)}</p>}
          {result?.conversationId && (
            <a
              href={`/read/${result.conversationId}`}
              className="mt-1 inline-flex font-medium text-link hover:underline"
            >
              {t('submit.viewProgress')}
            </a>
          )}
        </div>
      )}

      {/* Discover-by-name fallback: shown when the platform link couldn't be
          fetched (Spotify timeout/exclusive). User types the show name, we find
          its RSS via iTunes and list episodes — bypassing the closed platform. */}
      {error && /网络超时|Spotify 独占|spotify/i.test(error) && !result?.episodes && (
        <div className="rounded-lg border border-zinc-200 bg-surface px-3 py-3">
          <p className="mb-2 text-xs text-ink-muted">
            直接输入节目名，自动查找 RSS 源（绕过 Spotify）：
          </p>
          <div className="flex gap-2">
            <input
              value={discoverName}
              onChange={(e) => setDiscoverName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDiscoverByName(); }}
              placeholder="如：The Ezra Klein Show"
              className="min-w-0 flex-1 rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent-500"
            />
            <Button size="sm" onClick={() => handleDiscoverByName()} loading={discoverLoading}>
              {discoverLoading ? '查找中…' : '查找 RSS'}
            </Button>
          </div>
        </div>
      )}

      {/* A previous submit is still processing — offer the way back to it. */}
      {inflightId && !batchProgress && (
        <p className="text-xs text-ink-muted">
          {t('submit.inflight')}
          <a href={`/read/${inflightId}`} className="mx-1 text-link hover:underline">
            {t('submit.inflightLink')}
          </a>
        </p>
      )}

      {/* Batch progress */}
      {batchProgress && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-label" role="status" aria-live="polite">
              {t('submit.batch.progress', {
                done: batchProgress.completed,
                total: batchProgress.total,
              })}
              {batchProgress.failed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {t('submit.batch.failed', { count: batchProgress.failed })}
                </span>
              )}
            </p>
            {batchProgress.done && (
              <button
                type="button"
                onClick={() => setBatchProgress(null)}
                className="text-xs text-ink-muted hover:text-ink"
              >
                {t('common.clear')}
              </button>
            )}
          </div>
          {batchProgress.skippedQuota > 0 && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t('submit.batch.quotaSkipped', { count: batchProgress.skippedQuota })}
            </p>
          )}
          <Card padding="flat">
            <ul className="divide-y divide-line-soft">
              {batchProgress.episodes.map((ep) => (
                <li key={ep.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-subtle">{ep.title}</span>
                  {ep.ready ? (
                    <a
                      href={`/read/${ep.id}`}
                      className="text-xs font-medium text-link hover:underline"
                    >
                      {t('submit.read')}
                    </a>
                  ) : (
                    <StatusBadge status={ep.status} />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* Multi-episode selection */}
      {result?.multiEpisode && result.episodes && !batchProgress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="section-label">
              {t('submit.batch.title', {
                show: result.showTitle ? `《${result.showTitle}》` : t('submit.batch.fallbackShow'),
                count: result.episodes.length,
              })}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-ink-muted hover:text-ink"
              >
                {selectedKeys.size === (result.episodes?.length ?? 0) ? t('common.deselectAll') : t('common.selectAll')}
              </button>
              {selectedKeys.size > 0 && (
                <Button size="sm" onClick={handleBatchIngest} loading={batchLoading}>
                  {batchLoading ? t('submit.submitting') : t('submit.batch.run', { count: selectedKeys.size })}
                </Button>
              )}
            </div>
          </div>
          <Card padding="flat">
            <ul className="divide-y divide-line-soft">
              {result.episodes.slice(0, 50).map((ep) => (
                <li key={ep.episodeKey}>
                  <BatchEpisodeRow
                    ep={ep}
                    selected={selectedKeys.has(ep.episodeKey)}
                    onToggle={() => toggleSelect(ep.episodeKey)}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function BatchEpisodeRow({
  ep,
  selected,
  onToggle,
}: {
  ep: { episodeKey: string; title: string; description?: string; durationSec?: number; coverUrl?: string };
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const minutesLabel = (sec: number) => t('submit.minutes', { count: Math.round(sec / 60) });
  // Lazy Chinese summary: fetched on first expand, cached in component state.
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<{ translatedTitle?: string; summary?: string; skipped?: boolean } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !summary && !loadingSummary) {
      setLoadingSummary(true);
      try {
        const r = await fetch('/api/episodes/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: ep.title, description: ep.description }),
        });
        const j = await r.json();
        setSummary(j.data ?? { skipped: true });
      } catch {
        setSummary({ skipped: true });
      } finally {
        setLoadingSummary(false);
      }
    }
  };
  return (
    <div className="px-3 py-2.5 transition-colors hover:bg-surface-sunken">
      <div className="flex w-full items-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 flex-shrink-0 rounded border-line accent-accent-600"
        />
        <CoverImage src={ep.coverUrl} size={36} className="h-9 w-9 rounded" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink-subtle">{ep.title}</span>
          {ep.durationSec ? (
            <span className="ts-pill block">{minutesLabel(ep.durationSec)}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={toggleExpand}
          className="shrink-0 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink"
          aria-label="查看中文简介"
          title="查看中文简介"
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      {expanded && (
        <div className="mt-1.5 pl-[3.25rem] text-xs leading-relaxed text-ink-muted">
          {loadingSummary ? (
            <span>生成中文简介中…</span>
          ) : summary?.skipped ? (
            <span className="text-ink-faint">（中文节目，无需翻译）</span>
          ) : (
            <>
              {summary?.translatedTitle && <span className="block text-ink-subtle">{summary.translatedTitle}</span>}
              {summary?.summary && <span className="block">{summary.summary}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
