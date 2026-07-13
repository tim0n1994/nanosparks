/**
 * Dashboard — Corpus-centric view
 *
 * Per Track E.5: corpus cards (conversations / processing / failed count),
 * recent conversations, failed jobs one-click retry.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const lang = getLang((await cookies()).toString());

  // Corpus cards with conversation counts
  const corpora = await prisma.corpus.findMany({
    include: {
      _count: { select: { conversations: true, sources: true } },
      conversations: {
        select: { id: true, status: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Aggregate stats
  const totalCorpora = corpora.length;
  const totalConversations = corpora.reduce((s, c) => s + c._count.conversations, 0);
  const processing = corpora.reduce(
    (s, c) => s + c.conversations.filter((conv) => ['pending', 'downloading', 'transcribing', 'analyzing'].includes(conv.status)).length,
    0,
  );
  const failed = corpora.reduce(
    (s, c) => s + c.conversations.filter((conv) => conv.status === 'failed').length,
    0,
  );

  const statCards = [
    { key: 'corpora', value: totalCorpora, color: 'bg-blue-50 text-blue-900' },
    { key: 'conversations', value: totalConversations, color: 'bg-green-50 text-green-900' },
    { key: 'processing', value: processing, color: 'bg-yellow-50 text-yellow-900' },
    { key: 'failed', value: failed, color: 'bg-red-50 text-red-900' },
  ];

  // Recent conversations across all corpora
  const recentConversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: {
      corpus: { select: { id: true, name: true } },
      source: { select: { id: true, status: true } },
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('dashboard.title', lang)}</h1>

        {/* Stats */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat) => (
            <div key={stat.key} className={`rounded-lg p-4 ${stat.color}`}>
              <p className="text-sm opacity-80">{t(`dashboard.${stat.key}`, lang)}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Corpus cards */}
        {corpora.length === 0 ? (
          <EmptyState
            title={t('corpora.empty.title', lang)}
            description={t('corpora.empty.desc', lang)}
            action={<Link href="/submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">{t('error.analyzeNow', lang)}</Link>}
          />
        ) : (
          <div className="mb-8">
            <h2 className="font-semibold text-gray-900 mb-3">Corpora</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {corpora.map((corpus) => {
                const convProcessing = corpus.conversations.filter((c) =>
                  ['pending', 'transcribing', 'analyzing'].includes(c.status),
                ).length;
                const convFailed = corpus.conversations.filter((c) => c.status === 'failed').length;

                return (
                  <Link
                    key={corpus.id}
                    href={`/corpora/${corpus.id}`}
                    className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow group"
                  >
                    <h3 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                      {corpus.name}
                    </h3>
                    {corpus.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{corpus.description}</p>
                    )}
                    <div className="flex gap-3 mt-3 text-xs">
                      <span className="text-gray-400">
                        {corpus._count.conversations} conversations
                      </span>
                      {convProcessing > 0 && (
                        <span className="text-yellow-600">{convProcessing} processing</span>
                      )}
                      {convFailed > 0 && (
                        <span className="text-red-600">{convFailed} failed</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent conversations */}
        {recentConversations.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{t('dashboard.recent', lang)}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {recentConversations.map((conv) => (
                <div key={conv.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <Link
                      href={`/corpora/${conv.corpusId}`}
                      className="text-sm text-gray-900 hover:text-primary-600"
                    >
                      <span className="font-medium">{conv.title || 'Untitled'}</span>
                      <span className="text-gray-400 ml-2">· {conv.corpus.name}</span>
                    </Link>
                    <p className="text-xs text-gray-400 mt-0.5">{conv.updatedAt.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={conv.status} />
                    {conv.status === 'failed' && conv.source && (
                      <button
                        className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
                        onClick={() => {
                          fetch(`/api/sources/${conv.source!.id}`, { method: 'POST' }).catch(() => {});
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
