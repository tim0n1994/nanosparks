import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function PlaylistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = getLang((await cookies()).toString());
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: {
      episodes: {
        include: { episode: { include: { channel: true } } },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!playlist) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{playlist.name}</h1>
          <p className="text-gray-500 mt-1">{playlist.description}</p>
          <div className="flex gap-3 mt-4">
            <button disabled className="px-4 py-2 bg-gray-300 text-white rounded-lg text-sm font-medium cursor-not-allowed">
              {t('playlist.crossMap', lang)}
            </button>
            <button
              className="px-4 py-2 bg-white text-gray-700 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
              onClick={() => {
                if (typeof navigator !== 'undefined') {
                  navigator.clipboard.writeText(`${window.location.origin}/share/${playlist.shareId}`);
                }
              }}
            >
              {t('playlist.share', lang)}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {playlist.episodes.map((pe, idx) => (
            <Link
              key={pe.episode.id}
              href={`/visualization/${pe.episode.id}`}
              className="flex items-center gap-4 bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <span className="text-lg font-bold text-gray-300 w-8">{idx + 1}</span>
              <div className="flex-1">
                <h3 className="font-medium text-gray-900">{pe.episode.title}</h3>
                <p className="text-sm text-gray-500">{pe.episode.channel?.title || t('playlist.unknownChannel', lang)}</p>
              </div>
              <span className="text-sm text-gray-400">{Math.floor(pe.episode.duration / 60)}m</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
