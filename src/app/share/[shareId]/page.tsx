import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ReferencePanel from '@/components/visualization/ReferencePanel';
import QuoteCard from '@/components/visualization/QuoteCard';
import { AnalysisResult } from '@/types/analysis';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const lang = getLang((await cookies()).toString());

  const playlist = await prisma.playlist.findUnique({
    where: { shareId },
    include: {
      episodes: {
        include: {
          episode: {
            include: { analysis: { include: { references: true } }, channel: true },
          },
        },
      },
    },
  });

  if (!playlist) notFound();

  const firstEpisode = playlist.episodes[0]?.episode;
  const analysis: AnalysisResult | null = firstEpisode?.analysis
    ? {
        arguments: firstEpisode.analysis.arguments as unknown as AnalysisResult['arguments'],
        speakers: (firstEpisode.analysis.speakers as unknown as AnalysisResult['speakers']).map((s) => ({ ...s, color: s.color || '#3b82f6', speakingTime: s.speakingTime || 0 })),
        topics: firstEpisode.analysis.topics as unknown as AnalysisResult['topics'],
        quotes: firstEpisode.analysis.quotes as unknown as AnalysisResult['quotes'],
        references: firstEpisode.analysis.references.map((r) => ({ id: r.id, url: r.url, title: r.title, description: r.description || undefined, relevanceScore: r.relevanceScore })),
        generatedAt: firstEpisode.analysis.generatedAt,
      }
    : null;

  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="bg-surface-raised border-b border-line">
        <div className="mx-auto max-w-reading px-5 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-link">NanoSparks</h1>
          <span className="text-xs text-ink-muted">{t('share.sharedViz', lang)}</span>
        </div>
      </div>
      <main id="main" className="mx-auto max-w-reading px-5 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-ink">{playlist.name}</h2>
          <p className="text-ink-muted">{playlist.description}</p>
        </div>
        {analysis ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-ink mb-3">金句</h3>
              <div className="space-y-3">
                {analysis.quotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} speaker={analysis.speakers.find((s) => s.id === quote.speakerId)!} />
                ))}
              </div>
            </div>
            <ReferencePanel references={analysis.references} />
          </div>
        ) : (
          <div className="text-center py-12 text-ink-muted">{t('share.noAnalysis', lang)}</div>
        )}
        <div className="mt-8 text-center">
          <p className="text-sm text-ink-muted">{t('share.poweredBy', lang)}</p>
        </div>
      </main>
    </div>
  );
}
