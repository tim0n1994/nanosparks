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
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Ask</h1>

        {/* Query form */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about this corpus..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Ask'}
            </button>
          </div>
        </form>

        {error && <div className="p-4 text-red-500 bg-red-50 rounded-lg mb-4">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Answer panel (2/3) */}
          <div className="lg:col-span-2">
            {(answer || loading) && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-sm font-semibold text-gray-500 mb-3">Answer</h2>
                {loading && !answer && <LoadingSpinner />}
                <div ref={answerRef} className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
                  {renderAnswerWithCitations(answer)}
                  {loading && answer && <span className="animate-pulse">▊</span>}
                </div>
                {stats && (
                  <div className="mt-4 pt-4 border-t border-gray-100 flex gap-4 text-xs text-gray-400">
                    <span>{stats.thoughtUnitsFound} thought units</span>
                    <span>·</span>
                    <span>{stats.conversationsReferenced} conversations</span>
                    {stats.citationsVerified !== undefined && (
                      <>
                        <span>·</span>
                        <span className="text-green-500">{stats.citationsVerified} verified citations</span>
                      </>
                    )}
                    {stats.citationsUnverified !== undefined && stats.citationsUnverified > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-red-500">{stats.citationsUnverified} unverified</span>
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
                <h2 className="text-sm font-semibold text-gray-500">Sources ({sources.length})</h2>
                {sources.map((source, i) => (
                  <div
                    key={source.thoughtUnitId}
                    className={`bg-white rounded-lg border p-3 transition-all cursor-pointer ${
                      activeCitation === i + 1
                        ? 'border-primary-400 ring-2 ring-primary-100'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setActiveCitation(activeCitation === i + 1 ? null : i + 1)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">
                        [{i + 1}]
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {source.type}
                      </span>
                      {source.rrfScore !== undefined && (
                        <span className="text-xs text-gray-400">
                          {(source.rrfScore * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 line-clamp-3">{source.text}</p>
                    {source.conversationTitle && (
                      <p className="text-xs text-gray-400 mt-1">{source.conversationTitle}</p>
                    )}
                    {activeCitation === i + 1 && source.quotes.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                        {source.quotes.map((q, qi) => (
                          <div key={qi} className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                            <p className="italic">&ldquo;{q.quote.slice(0, 120)}&rdquo;</p>
                            <p className="mt-1 text-gray-400">
                              {(q.startMs / 1000).toFixed(0)}s – {(q.endMs / 1000).toFixed(0)}s
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
