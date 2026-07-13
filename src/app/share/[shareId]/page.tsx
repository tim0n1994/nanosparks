import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ReferencePanel from '@/components/visualization/ReferencePanel';
import QuoteCard from '@/components/visualization/QuoteCard';
import { AnalysisResult } from '@/types/analysis';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: { shareId: string } }) {
  const lang = getLang(cookies().toString());

  const playlist = await prisma.playlist.findUnique({
    where: { shareId: params.shareId },
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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-primary-600">NanoSparks</h1>
          <span className="text-xs text-gray-400">{t('share.sharedViz', lang)}</span>
        </div>
      </div>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">{playlist.name}</h2>
          <p className="text-gray-500">{playlist.description}</p>
        </div>
        {analysis ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">Key Quotes</h3>
              <div className="space-y-3">
                {analysis.quotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} speaker={analysis.speakers.find((s) => s.id === quote.speakerId)!} />
                ))}
              </div>
            </div>
            <ReferencePanel references={analysis.references} />
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">{t('share.noAnalysis', lang)}</div>
        )}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">{t('share.poweredBy', lang)}</p>
        </div>
      </main>
    </div>
  );
}
