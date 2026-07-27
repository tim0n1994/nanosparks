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

const LIST_LIMIT = 200;

export default async function DashboardPage() {
  const lang = getLang((await cookies()).toString());

  // Stats across ALL conversations (not just the displayed list), so batch
  // jobs submitted via the web UI or directly via the ingest API / queue all
  // count here. One aggregate query — cheap even at thousands of rows.
  const statusCounts = await prisma.conversation.groupBy({
    by: ['status'],
    _count: true,
  });
  const countOf = (statuses: string[]) =>
    statusCounts.filter((s) => statuses.includes(s.status ?? '')).reduce((n, s) => n + s._count, 0);
  const total = statusCounts.reduce((n, s) => n + s._count, 0);
  const ready = countOf(['completed', 'transcribed']);
  const processing = countOf(['pending', 'transcribing', 'analyzing', 'processing', 'downloading', 'diarizing', 'extracting']);
  const failed = countOf(['failed']);

  // Queue depth: how many transcribe/analyze jobs are in flight. Lets you see
  // real backlog progress regardless of where the task originated.
  let queueDepth = { transcribe: { wait: 0, active: 0 }, analyze: { wait: 0, active: 0 } };
  try {
    const { transcribeQueue, analyzeQueue } = await import('@/lib/queue/config');
    const [tc, ac] = await Promise.all([
      transcribeQueue.getJobCounts('waiting', 'active'),
      analyzeQueue.getJobCounts('waiting', 'active'),
    ]);
    queueDepth = {
      transcribe: { wait: tc.waiting, active: tc.active },
      analyze: { wait: ac.waiting, active: ac.active },
    };
    await Promise.all([transcribeQueue.close(), analyzeQueue.close()]);
  } catch {
    // Worker infra unavailable (e.g. Redis down) — stats still render.
  }

  const recentConversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      corpus: { select: { name: true } },
      source: { select: { id: true, status: true } },
      _count: { select: { turns: true, thoughtUnits: true } },
    },
  });

  // Group by channel (corpus) so you can see per-show progress at a glance.
  const byChannel = new Map<string, { total: number; ready: number; processing: number; failed: number }>();
  for (const c of recentConversations) {
    const name = c.corpus?.name || t('shelf.untitled', lang);
    const cur = byChannel.get(name) ?? { total: 0, ready: 0, processing: 0, failed: 0 };
    cur.total++;
    if (['completed', 'transcribed'].includes(c.status)) cur.ready++;
    else if (c.status === 'failed') cur.failed++;
    else cur.processing++;
    byChannel.set(name, cur);
  }

  const isReady = (s: string | null) => ['completed', 'transcribed'].includes(s ?? '');
  const isProcessing = (s: string | null) =>
    ['pending', 'transcribing', 'analyzing', 'processing', 'downloading', 'diarizing', 'extracting'].includes(s ?? '');

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

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-surface-raised px-4 py-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{stat.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Queue depth — backlog across the whole system, web + agent jobs alike. */}
        {(queueDepth.transcribe.wait + queueDepth.transcribe.active + queueDepth.analyze.wait + queueDepth.analyze.active) > 0 && (
          <div className="mb-6 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {lang === 'en' ? 'Queue' : '流水线队列'}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
              <span>
                {lang === 'en' ? 'Transcribing' : '转写'}: <span className="font-medium text-ink">{queueDepth.transcribe.active}</span>
                {lang === 'en' ? ' active' : ' 进行中'} · <span className="font-medium text-ink">{queueDepth.transcribe.wait}</span>
                {lang === 'en' ? ' queued' : ' 排队'}
              </span>
              <span>
                {lang === 'en' ? 'Analyzing' : '导读生成'}: <span className="font-medium text-ink">{queueDepth.analyze.active}</span>
                {lang === 'en' ? ' active' : ' 进行中'} · <span className="font-medium text-ink">{queueDepth.analyze.wait}</span>
                {lang === 'en' ? ' queued' : ' 排队'}
              </span>
            </div>
          </div>
        )}

        {/* Per-channel progress bars — see which show is how far along. */}
        {byChannel.size > 0 && (
          <div className="mb-8 rounded-xl border border-line bg-surface-raised px-4 py-3">
            <p className="mb-3 text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {lang === 'en' ? 'By channel' : '按频道'}
            </p>
            <ul className="space-y-2.5">
              {[...byChannel.entries()]
                .sort((a, b) => b[1].total - a[1].total)
                .map(([name, c]) => {
                  const pct = c.total ? Math.round((c.ready / c.total) * 100) : 0;
                  return (
                    <li key={name}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-ink">{name}</span>
                        <span className="ml-2 flex-shrink-0 tabular-nums text-ink-muted">
                          {c.ready}/{c.total}
                          {c.processing > 0 && <span className="text-amber-600 dark:text-amber-400"> · {c.processing} {lang === 'en' ? 'working' : '进行'}</span>}
                          {c.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {c.failed} {lang === 'en' ? 'failed' : '失败'}</span>}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}

        <nav aria-label={t('shelf.otherViews', lang)} className="mb-8 grid gap-3 sm:grid-cols-2">
          <Link href="/corpora" className="group rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-ink-muted">
            <span className="block text-sm font-medium text-ink group-hover:text-link">{t('shelf.collections', lang)}</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{t('shelf.collectionsHint', lang)}</span>
          </Link>
          <Link href="/playlists" className="group rounded-xl border border-line bg-surface-raised px-4 py-3 transition-colors hover:border-ink-muted">
            <span className="block text-sm font-medium text-ink group-hover:text-link">{t('shelf.playlists', lang)}</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{t('shelf.playlistsHint', lang)}</span>
          </Link>
        </nav>

        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="section-label mb-3">
            {t('shelf.recent', lang)} <span className="ml-1 text-ink-muted">({recentConversations.length})</span>
          </h2>
          {recentConversations.length === 0 ? (
            <EmptyState
              title={t('shelf.empty.title', lang)}
              description={t('shelf.empty.desc', lang)}
              action={<Link href="/submit" className={buttonStyles('primary')}>{t('shelf.empty.cta', lang)}</Link>}
            />
          ) : (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface-raised">
              {recentConversations.map((conv) => {
                const turns = conv._count.turns;
                const tus = conv._count.thoughtUnits;
                return (
                  <li key={conv.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken">
                    <div className="min-w-0 flex-1">
                      <Link href={`/read/${conv.id}`} className="block truncate text-sm font-medium text-ink hover:text-link">
                        {conv.title || t('shelf.untitled', lang)}
                      </Link>
                      <p className="mt-0.5 font-mono text-2xs text-ink-muted">
                        {dateFmt.format(conv.updatedAt)}
                        {conv.corpus?.name ? ` · ${conv.corpus.name}` : ''}
                        {/* Progress: turns / extracted thought-units. Shows how far each episode got. */}
                        {turns > 0 && (
                          <>
                            {' · '}
                            <span className={isReady(conv.status) ? 'text-ink-muted' : 'text-amber-600 dark:text-amber-400'}>
                              {turns} {lang === 'en' ? 'turns' : '段'}
                            </span>
                            {tus > 0 && <span className="text-ink-muted"> · {tus} {lang === 'en' ? 'insights' : '观点'}</span>}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <StatusBadge status={conv.status} lang={lang} />
                      {conv.status === 'failed' && conv.source && (
                        <RetryButton conversationId={conv.id} fullPipeline />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
