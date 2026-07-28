/**
 * Corpus Hub — the collection overview.
 *
 * Was a dead-end inline search box that duplicated /ask (the streaming
 * version). Now a server-component hub that wires the three things already
 * built but unreachable from here: the 3D graph (/graph), streaming Q&A
 * (/ask), and per-episode pipeline progress (same query as /dashboard).
 *
 * Reuses: getLang/t, buttonStyles, StatusBadge — no new components.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import StatusBadge from '@/components/ui/StatusBadge';
import { buttonStyles } from '@/components/ui/Button';
import { prisma } from '@/lib/prisma';
import CorpusMetaPanels from '@/components/dashboard/CorpusMetaPanels';
import { getLang, t } from '@/lib/i18n/getLang';
import { READY_STATUSES, PROCESSING_STATUSES } from '@/lib/status';

export const dynamic = 'force-dynamic';

export default async function CorpusHubPage({ params }: { params: Promise<{ corpusId: string }> }) {
  const { corpusId } = await params;
  const lang = getLang((await cookies()).toString());

  const corpus = await prisma.corpus.findUnique({
    where: { id: corpusId },
    include: {
      _count: {
        select: { conversations: true, sources: true, graphNodes: true, graphEdges: true },
      },
    },
  });
  if (!corpus) notFound();

  const conversations = await prisma.conversation.findMany({
    where: { corpusId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { turns: true, thoughtUnits: true } },
    },
    take: 200,
  });

  const ready = conversations.filter((c) => READY_STATUSES.includes(c.status ?? '')).length;
  const processing = conversations.filter((c) => PROCESSING_STATUSES.includes(c.status ?? '')).length;
  const failed = conversations.filter((c) => c.status === 'failed').length;
  const hasGraph = corpus._count.graphNodes > 0;
  const tuTotal = conversations.reduce((n, c) => n + c._count.thoughtUnits, 0);

  const dateFmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        {/* ── Breadcrumb + Header ── */}
        <div className="mb-6">
          <Link
            href="/corpora"
            className="text-sm text-ink-muted transition-colors hover:text-link"
          >
            <span aria-hidden="true">←</span> {t('corpora.allCollections', lang)}
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-ink">{corpus.name}</h1>
          {corpus.description && (
            <p className="mt-1 text-ink-muted">{corpus.description}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>{t('corpora.conversations', lang, { count: conversations.length })}</span>
            <span>·</span>
            <span>{t('graph.units', lang, { count: tuTotal })}</span>
            {hasGraph && (
              <>
                <span>·</span>
                <span>{t('graph.nodes', lang, { count: corpus._count.graphNodes })}</span>
              </>
            )}
          </div>
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <Link
            href={`/corpora/${corpusId}/graph`}
            className={`group rounded-xl border border-line bg-surface-raised px-5 py-4 transition-colors hover:border-ink-muted ${
              !hasGraph ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-ink group-hover:text-link">
                {t('graph.title', lang)}
              </span>
              <span className="text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{t('corpora.graphHint', lang)}</p>
            {hasGraph && (
              <p className="mt-2 font-mono text-2xs text-ink-subtle">
                {t('graph.nodes', lang, { count: corpus._count.graphNodes })} ·{' '}
                {t('graph.edges', lang, { count: corpus._count.graphEdges })}
              </p>
            )}
          </Link>

          <Link
            href={`/corpora/${corpusId}/ask`}
            className="group rounded-xl border border-line bg-surface-raised px-5 py-4 transition-colors hover:border-ink-muted"
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-ink group-hover:text-link">
                {t('query.ask', lang)}
              </span>
              <span className="text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{t('corpora.askHint', lang)}</p>
          </Link>
          <Link
            href={`/corpora/${corpusId}/trends`}
            className="group rounded-xl border border-line bg-surface-raised px-5 py-4 transition-colors hover:border-ink-muted"
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold text-ink group-hover:text-link">
                {t('corpora.trends', lang)}
              </span>
              <span className="text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{t('corpora.trendsHint', lang)}</p>
          </Link>
        </div>

        {/* ── Pipeline progress summary ── */}
        {(processing > 0 || failed > 0) && (
          <div className="mb-6 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
              <span>
                {lang === 'en' ? 'Ready' : '可读'}: <strong className="font-medium text-emerald-600 dark:text-emerald-400">{ready}</strong>
              </span>
              {processing > 0 && (
                <span>
                  {lang === 'en' ? 'Processing' : '处理中'}: <strong className="font-medium text-amber-600 dark:text-amber-400">{processing}</strong>
                </span>
              )}
              {failed > 0 && (
                <span>
                  {lang === 'en' ? 'Failed' : '失败'}: <strong className="font-medium text-red-600 dark:text-red-400">{failed}</strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Episode list (same pattern as /dashboard) ── */}
        <section aria-labelledby="episodes-heading">
          <h2 id="episodes-heading" className="section-label mb-3">
            {t('corpora.episodes', lang)}{' '}
            <span className="ml-1 text-ink-muted">({conversations.length})</span>
          </h2>
          {conversations.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('corpora.noEpisodes', lang)}</p>
          ) : (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface-raised">
              {conversations.map((conv) => {
                const turns = conv._count.turns;
                const tus = conv._count.thoughtUnits;
                const isReady = READY_STATUSES.includes(conv.status ?? '');
                return (
                  <li key={conv.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/read/${conv.id}`}
                        className="block truncate text-sm font-medium text-ink hover:text-link"
                      >
                        {conv.title || t('shelf.untitled', lang)}
                      </Link>
                      <p className="mt-0.5 font-mono text-2xs text-ink-muted">
                        {dateFmt.format(conv.updatedAt)}
                        {turns > 0 && (
                          <>
                            {' · '}
                            <span className={isReady ? 'text-ink-muted' : 'text-amber-600 dark:text-amber-400'}>
                              {turns} {lang === 'en' ? 'turns' : '段'}
                            </span>
                            {tus > 0 && (
                              <span className="text-ink-muted"> · {tus} {lang === 'en' ? 'insights' : '观点'}</span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <StatusBadge status={conv.status} lang={lang} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── C/D/E: processing runs, glossary, context-pack export ── */}
        <CorpusMetaPanels corpusId={corpusId} showName={corpus.name} />
        {/* ── Footer: search modes explainer (kept from old page — still useful) ── */}
        <div className="mt-8 rounded-xl border border-line bg-surface-raised p-5">
          <h2 className="text-sm font-semibold text-ink-subtle mb-3">{t('corpora.aboutModes', lang)}</h2>
          <div className="space-y-3 text-sm text-ink-subtle">
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🔤</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.keyword', lang)}</span> — {t('query.mode.keywordDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🧠</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.semantic', lang)}</span> — {t('query.mode.semanticDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">⚡</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.hybrid', lang)}</span> — {t('query.mode.hybridDesc', lang)}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
