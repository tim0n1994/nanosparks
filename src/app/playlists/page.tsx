import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import EmptyState from '@/components/ui/EmptyState';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function PlaylistsPage() {
  const lang = getLang((await cookies()).toString());
  const playlists = await prisma.playlist.findMany({
    include: { _count: { select: { episodes: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('playlists.title', lang)}</h1>
          <Link
            href="/playlists/new"
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
          >
            {t('playlists.new', lang)}
          </Link>
        </div>

        {playlists.length === 0 ? (
          <EmptyState
            title={t('playlists.empty.title', lang)}
            description={t('playlists.empty.desc', lang)}
          />
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {playlists.map((playlist) => (
              <Link
                key={playlist.id}
                href={`/playlists/${playlist.id}`}
                className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <h3 className="font-semibold text-gray-900">{playlist.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{t('playlist.episodes', lang, { count: playlist._count.episodes })}</p>
                <p className="text-xs text-gray-400 mt-2">{t('playlist.created', lang, { date: playlist.createdAt.toLocaleDateString() })}</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
