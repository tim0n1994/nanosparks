import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import ArgumentThread from '@/components/visualization/ArgumentThread';
import SummaryCard from '@/components/visualization/SummaryCard';
import MindmapTree from '@/components/visualization/MindmapTree';
import TranscriptPanel from '@/components/visualization/TranscriptPanel';
import QuoteCard from '@/components/visualization/QuoteCard';
import KeywordsBar from '@/components/visualization/KeywordsBar';
import HighlightsList from '@/components/visualization/HighlightsList';
import ShowNotes from '@/components/ui/ShowNotes';
import StatusBadge from '@/components/ui/StatusBadge';
import { AnalysisResult } from '@/types/analysis';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function VisualizationPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const lang = getLang((await cookies()).toString());

  const episode = await prisma.episode.findFirst({
    where: { OR: [{ id: episodeId }, { youtubeId: episodeId }] },
    include: {
      channel: true,
      analysis: { include: { references: true } },
    },
  });

  if (!episode) notFound();

  if (!episode.analysis) {
    return (
      <div className="min-h-[100dvh] bg-surface">
        <div className="mx-auto max-w-app px-5 py-12 text-center">
          <h1 className="text-2xl font-bold text-ink mb-4">{episode.title}</h1>
          <StatusBadge status={episode.status} />
          <p className="text-ink-muted mt-4">{t('viz.processing', lang)}</p>
          <Link href="/dashboard" className="inline-block mt-6 px-4 py-2 bg-accent-600 text-white rounded-lg text-sm font-medium hover:bg-accent-700">
            {t('viz.backToShelf', lang)}
          </Link>
        </div>
      </div>
    );
  }

  const analysis: AnalysisResult = {
    arguments: episode.analysis.arguments as unknown as AnalysisResult['arguments'],
    speakers: (episode.analysis.speakers as unknown as AnalysisResult['speakers']).map((s) => ({ ...s, color: s.color || '#3b82f6', speakingTime: s.speakingTime || 0 })),
    topics: episode.analysis.topics as unknown as AnalysisResult['topics'],
    quotes: episode.analysis.quotes as unknown as AnalysisResult['quotes'],
    references: episode.analysis.references.map((r) => ({ id: r.id, url: r.url, title: r.title, description: r.description || undefined, relevanceScore: r.relevanceScore })),
    generatedAt: episode.analysis.generatedAt,
  };

  // Summary
  const summaryData = (episode.analysis.summary as Record<string, unknown> | null) ?? {};
  const hasSummary = typeof summaryData.summary === 'string' && summaryData.summary.length > 0;

  // Transcript — split into natural utterance chunks
  const rawTranscript = episode.transcript as unknown;
  const rawSegments = Array.isArray(rawTranscript)
    ? rawTranscript.map((seg: Record<string, unknown>) => {
        const speakerRaw: string | undefined =
          typeof (seg as Record<string, unknown>).speakerId === 'string' ? (seg as Record<string, unknown>).speakerId as string
          : typeof (seg as Record<string, unknown>).speakerLabel === 'string' ? (seg as Record<string, unknown>).speakerLabel as string
          : typeof (seg as Record<string, unknown>).speaker === 'string' ? (seg as Record<string, unknown>).speaker as string
          : undefined;
        const isAnonymous = speakerRaw ? /^speaker_\d+$/.test(speakerRaw) : false;
        return {
          start: typeof seg.start === 'number' ? seg.start : (typeof seg.startMs === 'number' ? seg.startMs / 1000 : 0),
          end: typeof seg.end === 'number' ? seg.end : (typeof seg.endMs === 'number' ? seg.endMs / 1000 : 0),
          text: typeof seg.text === 'string' ? seg.text : '',
          speakerId: speakerRaw,
          speakerName: (speakerRaw && !isAnonymous) ? speakerRaw : undefined,
        };
      })
    : [];

  // Speaker maps needed for transcript
  const speakerColorMap: Record<string, string> = {};
  const speakerNames: Record<string, string> = {};
  const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
  analysis.speakers.forEach((s, i) => {
    speakerColorMap[s.id] = s.color || COLORS[i % COLORS.length];
    speakerNames[s.id] = s.name;
  });

  // Build transcriptSegments: use diarized segments directly when available
  const uniqueSpeakers = new Set(rawSegments.map((s) => s.speakerId).filter(Boolean));
  const hasDiarization = uniqueSpeakers.size >= 2 || [...uniqueSpeakers].some((s) => s && !/^speaker_\d+$/.test(s));

  let transcriptSegments: Array<{ start: number; end: number; text: string; speakerId?: string; speakerName?: string }>;

  if (hasDiarization && rawSegments.length > 5) {
    transcriptSegments = rawSegments;
  } else {
    // Fallback: no diarization — split merged text into chunks
    const mergedText = rawSegments.map((s) => s.text).join('');
    const cleanText = mergedText.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '');
    const totalDuration = rawSegments.reduce((sum, s) => sum + (s.end - s.start), 0) || 600;
    const totalChars = cleanText.length;
    const CHUNK = 150;
    const chunks: string[] = [];
    for (let pos = 0; pos < cleanText.length; pos += CHUNK) {
      chunks.push(cleanText.slice(pos, pos + CHUNK).trim());
    }

    const argData = analysis.arguments as Array<{ speakerId: string; timestamp: number }>;
    transcriptSegments = chunks.map((chunk: string) => {
      const charPos = cleanText.indexOf(chunk);
      const ratio = totalChars > 0 ? charPos / totalChars : 0;
      const estStart = totalDuration * ratio;
      const estEnd = estStart + (chunk.length / totalChars) * totalDuration;

      let speakerId: string | undefined;
      let bestDist = Infinity;
      for (const arg of argData) {
        const dist = Math.abs(arg.timestamp - estStart);
        if (dist < 180 && dist < bestDist) { bestDist = dist; speakerId = arg.speakerId; }
      }
      return { start: estStart, end: estEnd, text: chunk, speakerId, speakerName: speakerId && speakerNames[speakerId] ? speakerNames[speakerId] : undefined };
    });
  }

  // Highlights from quotes
  const highlights = analysis.quotes.map((q) => ({
    timestamp: q.timestamp,
    text: q.text,
    speaker: speakerNames[q.speakerId] || q.speakerId,
  }));

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}时${m}分` : `${m}分`;
  };

  return (
    <div className="min-h-[100dvh] bg-surface">
      <div className="mx-auto max-w-app px-5 py-6">

        {/* Header */}
        <div className="mb-6">
          <Link href="/dashboard" className="text-xs text-link hover:opacity-80 mb-2 inline-block">
            {t('viz.backToShelf', lang)}
          </Link>
          <h1 className="text-2xl font-bold text-ink">{episode.title}</h1>
          {episode.channel && (
            <p className="text-sm text-ink-muted mt-1">{episode.channel.title} · {formatDuration(episode.duration)}</p>
          )}
        </div>

        {/* Podwise layout: main + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Main column (3/5): Summary → Mindmap → Transcript → Clips */}
          <div className="lg:col-span-3 space-y-6">
            {/* 1. Summary */}
            {hasSummary && <SummaryCard data={summaryData as { summary: string; takeaways: string[]; language: string; host?: string }} />}

            {/* 2. Mindmap */}
            <MindmapTree topics={analysis.topics} arguments={analysis.arguments} speakerNames={speakerNames} />

            {/* 3. Transcript */}
            <TranscriptPanel segments={transcriptSegments} speakerColors={speakerColorMap} speakerNames={speakerNames} />

            {/* 4. Clips (Key Quotes) */}
            <div>
              <h3 className="font-semibold text-ink mb-3 text-lg">{t('viz.keyQuotes', lang)}</h3>
              <div className="space-y-3">
                {analysis.quotes.map((quote) => {
                  const speaker = analysis.speakers.find((s) => s.id === quote.speakerId);
                  if (!speaker) return null;
                  return <QuoteCard key={quote.id} quote={quote} speaker={speaker} />;
                })}
              </div>
            </div>
          </div>

          {/* Sidebar (2/5): Keywords → Highlights → Shownotes → References */}
          <div className="lg:col-span-2 space-y-6">

            {/* Shownotes (episode description) */}
            <div className="bg-surface-raised rounded-lg border border-line p-4">
              <h3 className="font-semibold text-ink text-sm mb-2">节目简介</h3>
              <ShowNotes description={episode.description} />
            </div>

            {/* 5. Keywords */}
            <KeywordsBar topics={analysis.topics} />

            {/* 6. Highlights */}
            <HighlightsList highlights={highlights} />

            {/* References — compact */}
            <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
              <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
                <h3 className="font-semibold text-ink text-sm">{t('viz.references', lang)}</h3>
              </div>
              <div className="divide-y divide-line-soft max-h-[400px] overflow-y-auto">
                {analysis.references.filter((r) => {
                  try { const u = new URL(r.url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
                }).map((ref) => (
                  <a key={ref.id} href={ref.url} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 hover:bg-surface-sunken transition-colors">
                    <h4 className="truncate text-xs font-medium text-link">{ref.title}</h4>
                    {ref.description && <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{ref.description}</p>}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
