import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import RetryButton from '@/components/dashboard/RetryButton';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { buttonStyles } from '@/components/ui/Button';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 15;

export default async function DashboardPage() {
  const lang = getLang((await cookies()).toString());

  const recentConversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: RECENT_LIMIT,
    include: {
      corpus: { select: { name: true } },
      source: { select: { id: true, status: true } },
    },
  });

  const total = recentConversations.length;
  const ready = recentConversations.filter((c) => ['completed', 'transcribed'].includes(c.status)).length;
  const processing = recentConversations.filter((c) =>
    ['pending', 'transcribing', 'analyzing', 'processing'].includes(c.status),
  ).length;
  const failed = recentConversations.filter((c) => c.status === 'failed').length;

  const stats = [
    { label: t('shelf.all', lang), value: total, color: 'text-ink' },
    { label: t('shelf.ready', lang), value: ready, color: 'text-emerald-600 dark:text-emerald-400' },
    { label: t('shelf.processing', lang), value: processing, color: 'text-amber-600 dark:text-amber-400' },
    { label: t('shelf.failed', lang), value: failed, color: 'text-red-600 dark:text-red-400' },
  ];

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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t('shelf.title', lang)}</h1>
          <Link href="/submit" className={buttonStyles('primary', 'sm')}>
            {t('shelf.newLink', lang)}
          </Link>
        </div>

        {/* Two columns on a phone rather than four 80px-wide cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-surface-raised px-4 py-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{stat.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* /playlists and /corpora were reachable from no page at all. */}
        <nav aria-label={t('shelf.otherViews', lang)} className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link
            href="/corpora"
            className="group rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-ink-muted"
          >
            <span className="block text-sm font-medium text-ink group-hover:text-link">{t('shelf.collections', lang)}</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{t('shelf.collectionsHint', lang)}</span>
          </Link>
          <Link
            href="/playlists"
            className="group rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-ink-muted"
          >
            <span className="block text-sm font-medium text-ink group-hover:text-link">{t('shelf.playlists', lang)}</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{t('shelf.playlistsHint', lang)}</span>
          </Link>
        </nav>

        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="section-label mb-3">
            {t('shelf.recent', lang)}
          </h2>
          {recentConversations.length === 0 ? (
            <EmptyState
              title={t('shelf.empty.title', lang)}
              description={t('shelf.empty.desc', lang)}
              action={
                <Link href="/submit" className={buttonStyles('primary')}>
                  {t('shelf.empty.cta', lang)}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface-raised">
              {recentConversations.map((conv) => (
                <li
                  key={conv.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/read/${conv.id}`}
                      className="block truncate text-sm font-medium text-ink hover:text-link"
                    >
                      {conv.title || t('shelf.untitled', lang)}
                    </Link>
                    <p className="mt-0.5 font-mono text-2xs text-ink-muted">
                      {dateFmt.format(conv.updatedAt)}
                      {conv.corpus?.name ? ` · ${conv.corpus.name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <StatusBadge status={conv.status} lang={lang} />
                    {conv.status === 'failed' && conv.source && (
                      <RetryButton conversationId={conv.id} fullPipeline />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
