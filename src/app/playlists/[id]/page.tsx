import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import CopyLinkButton from '@/components/ui/CopyLinkButton';
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
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        <div className="bg-surface-raised rounded-lg border border-line p-6 mb-6">
          <h1 className="text-2xl font-bold text-ink">{playlist.name}</h1>
          <p className="text-ink-muted mt-1">{playlist.description}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <CopyLinkButton path={`/share/${playlist.shareId}`} label={t('playlist.share', lang)} />
          </div>
        </div>

        <div className="space-y-3">
          {playlist.episodes.map((pe, idx) => (
            <Link
              key={pe.episode.id}
              href={`/visualization/${pe.episode.id}`}
              className="flex items-center gap-4 bg-surface-raised rounded-lg border border-line p-4 hover:shadow-md transition-shadow"
            >
              <span className="text-lg font-bold text-ink-muted w-8">{idx + 1}</span>
              <div className="flex-1">
                <h3 className="font-medium text-ink">{pe.episode.title}</h3>
                <p className="text-sm text-ink-muted">{pe.episode.channel?.title || t('playlist.unknownChannel', lang)}</p>
              </div>
              <span className="text-sm text-ink-muted">{Math.floor(pe.episode.duration / 60)}m</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
