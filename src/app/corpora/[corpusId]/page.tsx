'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import SearchModeSelector from '@/components/search/SearchModeSelector';
import { useTranslation } from '@/lib/i18n/useTranslation';

type SearchMode = 'keyword' | 'semantic' | 'hybrid';

interface Source {
  thoughtUnitId: string;
  type: string;
  text: string;
  conversationTitle: string | null;
  confidence: number;
  similarity?: number;
  quotes: Array<{ quote: string; startMs: number; endMs: number }>;
}

interface QueryResponse {
  answer: string;
  sources: Source[];
  searchMode: string;
  stats: {
    thoughtUnitsFound: number;
    conversationsReferenced: number;
  };
}

interface CorpusInfo {
  id: string;
  name: string;
  description: string | null;
  conversationCount: number;
  sourceCount: number;
}

export default function CorpusQueryPage() {
  const params = useParams();
  const corpusId = params.corpusId as string;
  const { t, lang } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [graphStats, setGraphStats] = useState<{
    thoughtUnits: number;
    conversations: number;
    graphNodes: number;
  } | null>(null);

  // Fetch corpus info and graph stats on mount
  useEffect(() => {
    async function loadCorpus() {
      try {
        const graphRes = await fetch(`/api/corpora/${corpusId}/graph`);
        if (graphRes.ok) {
          const data = await graphRes.json();
          setCorpus(data.corpus);
          setGraphStats(data.stats);
        }
      } catch {
        // Corpus info is supplementary; page still works
      }
    }
    loadCorpus();
  }, [corpusId]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`/api/corpora/${corpusId}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), mode, maxResults: 10 }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || tRef.current('query.requestFailed', { status: res.status }));
      }

      const data: QueryResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tRef.current('query.networkError'));
    } finally {
      setLoading(false);
    }
  }, [query, mode, corpusId]);

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        {/* ── Header ── */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink">
            {corpus?.name || t('query.title')}
          </h1>
          {corpus?.description && (
            <p className="text-ink-muted mt-1">{corpus.description}</p>
          )}
          {graphStats && (
            <div className="flex gap-4 mt-3 text-sm text-ink-muted">
              <span>{t('corpora.conversations', { count: graphStats.conversations })}</span>
              <span>·</span>
              <span>{graphStats.thoughtUnits} {t('query.thoughtUnits')}</span>
              <span>·</span>
              <span>{graphStats.graphNodes} graph nodes</span>
            </div>
          )}
        </div>

        {/* ── Search Form ── */}
        <form onSubmit={handleSubmit} className="bg-surface-raised rounded-xl border border-line p-6 mb-6">
          <div className="flex flex-col gap-4">
            <label htmlFor="query-input" className="text-sm font-medium text-ink-subtle">
              {t('query.ask')}
            </label>
            <div className="flex gap-3">
              <input
                id="query-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('query.placeholder')}
                className="flex-1 px-4 py-2.5 border border-line rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                disabled={loading}
                autoFocus
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="px-6 py-2.5 bg-accent-600 text-white rounded-lg font-medium text-sm hover:bg-accent-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t('query.searching')}
                  </span>
                ) : t('query.search')}
              </button>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="mt-4 pt-4 border-t border-line-soft">
            <SearchModeSelector mode={mode} onChange={setMode} />
          </div>
        </form>

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <div className="space-y-6">
            {/* Stats Bar */}
            <div className="bg-surface-raised rounded-lg border border-line px-5 py-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-3">
                <span className="text-ink-muted">
                  {t('query.found')} <strong className="text-ink">{result.stats.thoughtUnitsFound}</strong> {t('query.thoughtUnits')}
                  {' '}{t('query.across')} <strong className="text-ink">{result.stats.conversationsReferenced}</strong> {t('query.conversations')}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-50 text-accent-700">
                  {result.searchMode}
                </span>
              </div>
              <button
                onClick={() => setQuery('')}
                className="text-ink-muted hover:text-ink-subtle text-xs"
              >
                {t('common.clear')}
              </button>
            </div>

            {/* Answer Card */}
            {result.answer && (
              <div className="bg-surface-raised rounded-xl border border-line p-6">
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-3">{t('query.answer')}</h2>
                <div className="prose prose-sm max-w-none text-ink leading-relaxed whitespace-pre-wrap">
                  {result.answer}
                </div>
              </div>
            )}

            {/* Sources */}
            {result.sources.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-3">
                  {t('query.sources', { count: result.sources.length })}
                </h2>
                <div className="space-y-3">
                  {result.sources.map((source, i) => (
                    <SourceCard key={source.thoughtUnitId} source={source} index={i} t={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Empty State ── */}
        {!result && !loading && !error && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🔍</div>
            <h2 className="text-lg font-semibold text-ink-subtle mb-2">{t('query.empty.title')}</h2>
            <p className="text-sm text-ink-muted max-w-md mx-auto">
              {t('query.empty.desc')}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function SourceCard({ source, index, t }: { source: Source; index: number; t: (key: string, params?: Record<string, string | number>) => string }) {
  const typeColors: Record<string, string> = {
    claim: 'bg-blue-100 text-blue-800',
    evidence: 'bg-green-100 text-green-800',
    question: 'bg-yellow-100 text-yellow-800',
    objection: 'bg-red-100 text-red-800',
    decision: 'bg-purple-100 text-purple-800',
    risk: 'bg-orange-100 text-orange-800',
    insight: 'bg-teal-100 text-teal-800',
  };
  const color = typeColors[source.type] || 'bg-surface-sunken text-ink';

  return (
    <div className="bg-surface-raised rounded-lg border border-line p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-sunken text-ink-muted text-xs font-bold flex items-center justify-center mt-0.5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
              {source.type}
            </span>
            <span className="text-xs text-ink-muted">
              {source.conversationTitle || t('query.unknownSource')}
            </span>
          </div>

          <p className="text-sm text-ink mb-2">{source.text}</p>

          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span>{t('query.confidence', { pct: Math.round(source.confidence * 100) })}</span>
            {source.similarity !== undefined && (
              <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
                {t('query.similarity', { pct: (source.similarity * 100).toFixed(0) })}
              </span>
            )}
          </div>

          {source.quotes.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-link hover:opacity-80">
                {t(source.quotes.length > 1 ? 'query.quotes' : 'query.quote', { count: source.quotes.length })}
              </summary>
              <div className="mt-2 space-y-1.5">
                {source.quotes.map((q, i) => (
                  <div key={i} className="text-xs text-ink-muted bg-surface-sunken rounded p-2 border border-line-soft">
                    <span className="block leading-relaxed">&ldquo;{q.quote}&rdquo;</span>
                    <span className="block text-ink-muted mt-0.5">
                      {formatMs(q.startMs)} – {formatMs(q.endMs)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
