'use client';

/**
 * CorpusMetaPanels — three collapsible panels surfacing backend-ready
 * capabilities that had no UI:
 *
 *  · Processing runs (C): per-run model / cost / status / thought-unit yield.
 *    Answers "what did this cost, which model, did it finish?" — visibility
 *    the dashboard's conversation-level status never showed.
 *  · Glossary (D): show-specific {wrong: right} term corrections POSTed to the
 *    hot-words layer that feeds the LLM transcription correction pass.
 *  · Context pack (E): one-tap export of structured claims + evidence +
 *    citations as markdown or json (agent-ready).
 *
 * All three hit existing endpoints; this component only adds the surface.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Collapsible from '@/components/ui/Collapsible';

interface RunRow {
  id: string;
  kind: string;
  model: string;
  status: string;
  costUsd: number | null;
  _count: { thoughtUnits: number };
}
interface RunsResponse {
  data: RunRow[];
  meta: { totalRuns: number; totalCostUsd: number; activeRuns: number };
}

interface Props {
  corpusId: string;
  showName?: string | null;
}

export default function CorpusMetaPanels({ corpusId, showName }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [newWrong, setNewWrong] = useState('');
  const [newRight, setNewRight] = useState('');
  const [glossarySaved, setGlossarySaved] = useState(false);
  const [packLoading, setPackLoading] = useState<'md' | 'json' | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`/api/corpora/${corpusId}/runs`);
      if (r.ok) setRuns(await r.json());
    } catch { /* supplementary */ }
  }, [corpusId]);

  const loadGlossary = useCallback(async () => {
    if (!showName) return;
    try {
      const r = await fetch(`/api/glossary?show=${encodeURIComponent(showName)}`);
      if (r.ok) {
        const j = await r.json();
        setTerms(j.terms ?? {});
      }
    } catch { /* supplementary */ }
  }, [showName]);

  useEffect(() => { loadRuns(); loadGlossary(); }, [loadRuns, loadGlossary]);

  const saveGlossary = async () => {
    if (!showName) return;
    try {
      await fetch('/api/glossary', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show: showName, terms }),
      });
      setGlossarySaved(true);
      setTimeout(() => setGlossarySaved(false), 2000);
    } catch { /* surface silently — toast infra not imported here */ }
  };

  const addTerm = () => {
    const w = newWrong.trim();
    const r = newRight.trim();
    if (!w || !r) return;
    setTerms((prev) => ({ ...prev, [w]: r }));
    setNewWrong('');
    setNewRight('');
  };

  const removeTerm = (key: string) => {
    setTerms((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const exportPack = async (format: 'markdown' | 'json') => {
    setPackLoading(format === 'markdown' ? 'md' : 'json');
    try {
      const r = await fetch(`/api/corpora/${corpusId}/context-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `corpus-${corpusId}.${format === 'markdown' ? 'md' : 'json'}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* silent */ } finally {
      setPackLoading(null);
    }
  };

  return (
    <>
      {/* ── C: Processing runs ── */}
      <Collapsible title={t('corpora.runs')}>
        {!runs ? (
          <p className="text-sm text-ink-muted">…</p>
        ) : runs.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('corpora.runsEmpty')}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-muted">
              {t('corpora.runsTotal', { count: runs.meta.totalRuns, cost: runs.meta.totalCostUsd.toFixed(4) })}
            </p>
            <ul className="space-y-1.5 font-mono text-2xs text-ink-muted">
              {runs.data.slice(0, 12).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={r.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : r.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>
                    {r.status}
                  </span>
                  <span className="text-ink">{r.kind}</span>
                  <span>· {r.model}</span>
                  {r.costUsd != null && <span>· ${r.costUsd.toFixed(4)}</span>}
                  {r._count.thoughtUnits > 0 && <span>· {r._count.thoughtUnits} TU</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Collapsible>

      {/* ── D: Glossary ── */}
      {showName && (
        <Collapsible title={t('corpora.glossary')}>
          <p className="mb-3 text-xs text-ink-muted">{t('corpora.glossaryHint')}</p>
          {Object.keys(terms).length > 0 && (
            <ul className="mb-3 space-y-1">
              {Object.entries(terms).map(([wrong, right]) => (
                <li key={wrong} className="flex items-center gap-2 text-sm">
                  <span className="text-red-600 dark:text-red-400 line-through">{wrong}</span>
                  <span className="text-ink-muted">→</span>
                  <span className="text-ink">{right}</span>
                  <button type="button" onClick={() => removeTerm(wrong)} className="ml-auto text-ink-muted hover:text-red-600" aria-label="remove">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-2xs text-ink-muted">
              {t('corpora.glossaryWrong')}
              <input value={newWrong} onChange={(e) => setNewWrong(e.target.value)} className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-ink-muted">
              {t('corpora.glossaryRight')}
              <input value={newRight} onChange={(e) => setNewRight(e.target.value)} className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink" />
            </label>
            <button type="button" onClick={addTerm} className="h-8 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-muted">
              {t('corpora.glossaryAdd')}
            </button>
            <button type="button" onClick={saveGlossary} className="h-8 rounded-md bg-accent-600 px-3 text-sm font-medium text-white hover:bg-accent-700">
              {glossarySaved ? t('corpora.glossarySaved') : 'Save'}
            </button>
          </div>
        </Collapsible>
      )}

      {/* ── E: Context pack export ── */}
      <Collapsible title={t('corpora.contextPack')}>
        <p className="mb-3 text-xs text-ink-muted">{t('corpora.contextPackHint')}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => exportPack('markdown')}
            disabled={packLoading !== null}
            className="h-9 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-muted disabled:opacity-40"
          >
            {packLoading === 'md' ? '…' : t('corpora.exportMarkdown')}
          </button>
          <button
            type="button"
            onClick={() => exportPack('json')}
            disabled={packLoading !== null}
            className="h-9 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-muted disabled:opacity-40"
          >
            {packLoading === 'json' ? '…' : t('corpora.exportJson')}
          </button>
        </div>
      </Collapsible>
    </>
  );
}
