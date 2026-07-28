/**
 * Corpus Trends — cross-episode insight page (B).
 *
 * Surfaces /api/corpora/:id/trends (generateCorpusReport): top recurring
 * claims, contested topics, unresolved questions, participant activity, and
 * thought-unit type distribution. All pre-computed by DB queries, no LLM.
 *
 * Server component — same fetch-on-client pattern as /graph, kept SSR-light
 * because the trends API can take seconds on a 16k-TU corpus.
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface TrendReport {
  summary: { totalConversations: number; totalThoughtUnits: number; totalParticipants: number };
  topClaims: Array<{ text: string; occurrenceCount: number; conversationCount: number }>;
  contestedTopics: Array<{ topic: string; supportCount: number; contradictCount: number; netScore: number }>;
  unresolvedQuestions: Array<{ text: string; conversationTitle: string; conversationId: string }>;
  participantActivity: Array<{ name: string; conversationCount: number; claimCount: number; topTypes: Array<{ type: string; count: number }> }>;
  typeDistribution: Array<{ type: string; count: number; percentage: number }>;
}

const TYPE_BAR_COLOR = 'bg-accent-500';

export default function CorpusTrendsPage() {
  const params = useParams();
  const corpusId = params.corpusId as string;
  const { t } = useTranslation();
  const [report, setReport] = useState<TrendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/corpora/${corpusId}/trends`);
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (!cancelled) setReport(data.report ?? data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [corpusId]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-surface">
        <Navbar />
        <main id="main" className="mx-auto max-w-app px-5 py-8">
          <p className="text-sm text-ink-muted">…</p>
        </main>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-[100dvh] bg-surface">
        <Navbar />
        <main id="main" className="mx-auto max-w-app px-5 py-8">
          <p className="text-sm text-red-600 dark:text-red-400">{error || t('trend.empty')}</p>
          <Link href={`/corpora/${corpusId}`} className="mt-4 inline-block text-sm text-link hover:underline">←</Link>
        </main>
      </div>
    );
  }

  const isEmpty = report.summary.totalThoughtUnits === 0;

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        <Link href={`/corpora/${corpusId}`} className="text-sm text-ink-muted hover:text-link">
          <span aria-hidden="true">←</span> {t('corpora.allCollections')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ink">{t('corpora.trends')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('corpora.trendsHint')}</p>

        {!isEmpty && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-ink-muted">
            <span>{report.summary.totalConversations} 集</span>
            <span>·</span>
            <span>{report.summary.totalThoughtUnits} TU</span>
            <span>·</span>
            <span>{report.summary.totalParticipants} 说话人</span>
          </div>
        )}

        {isEmpty ? (
          <p className="mt-8 text-sm text-ink-muted">{t('trend.empty')}</p>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Top claims */}
            {report.topClaims.length > 0 && (
              <section>
                <h2 className="section-label mb-3">{t('trend.topClaims')}</h2>
                <ul className="space-y-2">
                  {report.topClaims.slice(0, 8).map((c, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface-raised p-3">
                      <p className="text-sm text-ink">{c.text}</p>
                      <p className="mt-1 text-2xs text-ink-muted">
                        {t('trend.occurrences', { count: c.occurrenceCount, conv: c.conversationCount })}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Contested topics */}
            {report.contestedTopics.length > 0 && (
              <section>
                <h2 className="section-label mb-3">{t('trend.contested')}</h2>
                <ul className="space-y-2">
                  {report.contestedTopics.slice(0, 8).map((c, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface-raised p-3">
                      <p className="text-sm text-ink">{c.topic}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
                        <span className="text-emerald-600 dark:text-emerald-400">{t('trend.support', { n: c.supportCount })}</span>
                        <span className="text-red-600 dark:text-red-400">{t('trend.contradict', { n: c.contradictCount })}</span>
                        <span className="text-ink-muted">{t('trend.netScore', { n: c.netScore })}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Unresolved questions */}
            {report.unresolvedQuestions.length > 0 && (
              <section>
                <h2 className="section-label mb-3">{t('trend.unresolved')}</h2>
                <ul className="space-y-2">
                  {report.unresolvedQuestions.slice(0, 8).map((q, i) => (
                    <li key={i}>
                      <Link
                        href={`/read/${q.conversationId}`}
                        className="block rounded-lg border border-line bg-surface-raised p-3 transition-colors hover:border-ink-muted"
                      >
                        <p className="text-sm text-ink">{q.text}</p>
                        <p className="mt-1 text-2xs text-ink-muted">{q.conversationTitle}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Type distribution */}
            {report.typeDistribution.length > 0 && (
              <section>
                <h2 className="section-label mb-3">{t('trend.typeDist')}</h2>
                <div className="space-y-1.5">
                  {report.typeDistribution.map((d) => (
                    <div key={d.type} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-2xs text-ink-muted">{d.type}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <div className={`h-full ${TYPE_BAR_COLOR}`} style={{ width: `${d.percentage}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-2xs text-ink-muted">
                        {d.count} · {d.percentage}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Participant activity */}
            {report.participantActivity.length > 0 && (
              <section>
                <h2 className="section-label mb-3">{t('trend.participants')}</h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {report.participantActivity.slice(0, 12).map((p, i) => (
                    <li key={i} className="rounded-lg border border-line bg-surface-raised p-3">
                      <p className="text-sm font-medium text-ink">{p.name}</p>
                      <p className="mt-0.5 text-2xs text-ink-muted">
                        {p.conversationCount} 集 · {p.claimCount} 观点
                      </p>
                      {p.topTypes.length > 0 && (
                        <p className="mt-0.5 font-mono text-2xs text-ink-subtle">
                          {p.topTypes.map((tt) => `${tt.type}:${tt.count}`).join(' ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
