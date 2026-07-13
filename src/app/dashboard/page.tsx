import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const lang = getLang(cookies().toString());

  const totalEpisodes = await prisma.episode.count();
  const completed = await prisma.episode.count({ where: { status: 'COMPLETED' } });
  const processing = await prisma.episode.count({ where: { status: { in: ['PENDING', 'DOWNLOADING', 'TRANSCRIBING', 'ANALYZING'] } } });
  const failed = await prisma.episode.count({ where: { status: 'FAILED' } });

  const recentActivity = await prisma.episode.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: { channel: true },
  });

  const statCards = [
    { key: 'total', value: totalEpisodes, color: 'bg-blue-50 text-blue-900' },
    { key: 'completed', value: completed, color: 'bg-green-50 text-green-900' },
    { key: 'processing', value: processing, color: 'bg-yellow-50 text-yellow-900' },
    { key: 'failed', value: failed, color: 'bg-red-50 text-red-900' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('dashboard.title', lang)}</h1>

        <div className="grid md:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat) => (
            <div key={stat.key} className={`rounded-lg p-4 ${stat.color}`}>
              <p className="text-sm opacity-80">{t(`dashboard.${stat.key}`, lang)}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>

        {recentActivity.length === 0 ? (
          <EmptyState
            title={t('dashboard.empty.title', lang)}
            description={t('dashboard.empty.desc', lang)}
            action={<Link href="/submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">{t('error.analyzeNow', lang)}</Link>}
          />
        ) : (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{t('dashboard.recent', lang)}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {recentActivity.map((item) => (
                <Link
                  href={`/visualization/${item.youtubeId}`}
                  key={item.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{item.title}</span>
                      {item.channel && <span className="text-gray-500"> · {item.channel.title}</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.updatedAt.toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
