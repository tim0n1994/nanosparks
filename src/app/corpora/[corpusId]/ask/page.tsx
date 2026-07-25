/**
 * Ask Page — Streaming Q&A with Progressive Citations
 *
 * Per Track E.3: SSE streaming answer, citation cards render progressively,
 * click citation → scroll transcript to Turn and highlight evidence span.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Navbar from '@/components/ui/Navbar';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LoadingSpinner from '@/components/loading-spinner';

interface Source {
  thoughtUnitId: string;
  type: string;
  text: string;
  conversationTitle: string | null;
  confidence: number;
  quotes: Array<{ quote: string; startMs: number; endMs: number }>;
  rrfScore?: number;
}

interface QueryResponse {
  answer: string;
  sources: Source[];
  searchMode: string;
  stats: {
    thoughtUnitsFound: number;
    conversationsReferenced: number;
    citationsVerified?: number;
    citationsUnverified?: number;
  };
}

export default function AskPage() {
  const params = useParams();
  const corpusId = params.corpusId as string;
  const { t } = useTranslation();

  // V2/T-V2-9 §2.3: allow "以此提问" deep-links via ?q= to prefill the question.
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<QueryResponse['stats'] | null>(null);
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setAnswer('');
    setSources([]);
    setStats(null);

    try {
      // Use SSE streaming endpoint for progressive answer rendering
      const res = await fetch(`/api/corpora/${corpusId}/query-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), maxResults: 10 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Query failed');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const eventMatch = block.match(/^event: (.+)$/m);
          const dataMatch = block.match(/^data: (.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const eventType = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (eventType === 'sources') {
            setSources(data.sources);
          } else if (eventType === 'delta') {
            setAnswer((prev) => prev + data.text);
          } else if (eventType === 'done') {
            setStats(data.stats);
          } else if (eventType === 'error') {
            setError(data.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [query, corpusId]);

  // Parse citations [1], [2] from answer and render as clickable cards
  const renderAnswerWithCitations = (text: string) => {
    const parts = text.split(/(\[\d+(?:[,\s\-]+\d+)*\])/g);
    return parts.map((part, i) => {
      const citationMatch = part.match(/^\[(\d+(?:[,\s\-]+\d+)*)\]$/);
      if (citationMatch) {
        const num = parseInt(citationMatch[1], 10);
        const source = sources[num - 1];
        if (source) {
          return (
            <button
              key={i}
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-xs font-medium bg-accent-100 text-accent-700 hover:bg-accent-200 transition-colors"
              onClick={() => setActiveCitation(activeCitation === num ? null : num)}
            >
              [{num}]
            </button>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        <Link
          href={`/corpora/${corpusId}/graph`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <span aria-hidden="true">←</span> {t('query.backToGraph')}
        </Link>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">{t('query.ask')}</h1>

        {/* Query form */}
        <form onSubmit={handleSubmit} className="mb-6">
          <Field
            label={t('query.yourQuestion')}
            labelHidden
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('query.placeholder')}
            error={error || null}
            trailing={
              <Button type="submit" size="sm" loading={loading} disabled={!query.trim()} className="m-1 shrink-0">
                {loading ? t('query.searching') : t('query.search')}
              </Button>
            }
          />
        </form>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Answer panel (2/3) */}
          <div className="lg:col-span-2">
            {(answer || loading) && (
              <div className="rounded-xl border border-line bg-surface-raised p-6">
                <h2 className="section-label mb-3">{t('query.answer')}</h2>
                {loading && !answer && <LoadingSpinner text={t('query.searching')} />}
                <div
                  ref={answerRef}
                  aria-live="polite"
                  aria-busy={loading}
                  className="prose prose-sm max-w-none leading-relaxed text-ink"
                >
                  {renderAnswerWithCitations(answer)}
                  {loading && answer && <span className="animate-pulse">▊</span>}
                </div>
                {stats && (
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-4 text-xs text-ink-muted">
                    <span>{stats.thoughtUnitsFound} {t('query.thoughtUnits')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t('query.across')} {stats.conversationsReferenced} {t('query.conversations')}</span>
                    {stats.citationsVerified !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {t('query.citationsVerified', { count: stats.citationsVerified })}
                        </span>
                      </>
                    )}
                    {stats.citationsUnverified !== undefined && stats.citationsUnverified > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-red-600 dark:text-red-400">
                          {t('query.citationsUnverified', { count: stats.citationsUnverified })}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Citation cards (1/3) */}
          <div className="lg:col-span-1">
            {sources.length > 0 && (
              <div className="space-y-3">
                <h2 className="section-label">{t('query.sources', { count: sources.length })}</h2>
                {sources.map((source, i) => (
                  <button
                    key={source.thoughtUnitId}
                    type="button"
                    aria-expanded={activeCitation === i + 1}
                    className={`block w-full rounded-xl border bg-surface-raised p-3 text-left transition-colors ${
                      activeCitation === i + 1
                        ? 'border-accent-400 ring-2 ring-accent-500/20'
                        : 'border-line hover:border-ink-muted'
                    }`}
                    onClick={() => setActiveCitation(activeCitation === i + 1 ? null : i + 1)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-accent-100 text-accent-700">
                        [{i + 1}]
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken text-ink-subtle">
                        {source.type}
                      </span>
                      {source.rrfScore !== undefined && (
                        <span className="text-xs text-ink-muted">
                          {(source.rrfScore * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink line-clamp-3">{source.text}</p>
                    {source.conversationTitle && (
                      <p className="text-xs text-ink-muted mt-1">{source.conversationTitle}</p>
                    )}
                    {activeCitation === i + 1 && source.quotes.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-line-soft space-y-1">
                        {source.quotes.map((q, qi) => (
                          <div key={qi} className="text-xs text-ink-muted bg-surface-sunken rounded p-2">
                            <p className="italic">&ldquo;{q.quote.slice(0, 120)}&rdquo;</p>
                            <p className="mt-1 text-ink-muted">
                              {(q.startMs / 1000).toFixed(0)}s – {(q.endMs / 1000).toFixed(0)}s
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
