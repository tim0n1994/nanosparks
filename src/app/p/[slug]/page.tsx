/**
 * Public content page (C1) — /p/[slug].
 *
 * The acquisition + SEO engine. Renders 导读 + 章节 + 金句墙 (≤10 short quotes
 * with backlinks). Full transcript requires login (版权分层: public page only
 * shows summary + short quotes + 出处回链). Compliance-balanced per PRD ADR #5.
 *
 * SEO: h1 = 集标题 + "文字版"; schema.org PodcastEpisode JSON-LD; OG image;
 * targets「{节目名} 文字版/文稿」「{嘉宾名} 播客」.
 */

import { notFound } from 'next/navigation';
import CoverImage from '@/components/ui/CoverImage';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { platformLabel } from '@/lib/resolvers';

export const dynamic = 'force-dynamic';

const MAX_QUOTES = 10;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const source = await prisma.source.findUnique({
    where: { publicSlug: slug },
    select: {
      conversations: {
        take: 1,
        select: {
          title: true,
          globalEpisode: { select: { showTitle: true, coverUrl: true, durationSec: true, sourceUrl: true } },
        },
      },
    },
  });
  const conv = source?.conversations[0];
  if (!conv) return {};
  const title = `${conv.title} 文字版`;
  return {
    title,
    description: `${conv.globalEpisode?.showTitle ?? ''} ${conv.title} 的播客文字版、章节与金句。`,
    openGraph: {
      title,
      images: conv.globalEpisode?.coverUrl ? [conv.globalEpisode.coverUrl] : [],
    },
  };
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const source = await prisma.source.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
      platform: true,
      uri: true,
      conversations: {
        take: 1,
        select: {
          id: true,
          title: true,
          language: true,
          globalEpisode: {
            select: { showTitle: true, coverUrl: true, durationSec: true, sourceUrl: true, readCount: true },
          },
          participants: { select: { name: true, role: true } },
        },
      },
    },
  });

  if (!source || !source.conversations[0]) notFound();
  const conv = source.conversations[0];
  const conversationId = conv.id;

  const [insights, quotes] = await Promise.all([
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: { in: ['insight', 'decision'] } },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: 6,
      select: { id: true, type: true, text: true },
    }),
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: 'insight' },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: MAX_QUOTES,
      select: {
        id: true,
        text: true,
        evidenceSpans: { select: { startMs: true, quote: true, turn: { select: { participant: { select: { name: true } } } } } },
      },
    }),
  ]);

  const ge = conv.globalEpisode;
  const platform = source.platform ? platformLabel(source.platform) : null;
  // Guest/participant names enrich JSON-LD so "{嘉宾名} 播客" queries can match (PRD §C1).
  const guestNames = (conv.participants ?? [])
    .filter((p) => p.role !== 'host')
    .map((p) => p.name)
    .slice(0, 6);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: conv.title,
    partOfSeries: ge?.showTitle ? { '@type': 'PodcastSeries', name: ge.showTitle } : undefined,
    // Participants as Person entities (hosts + guests) for richer SEO.
    actor: (conv.participants ?? []).slice(0, 6).map((p) => ({ '@type': 'Person', name: p.name })),
    description: insights.map((i) => i.text).join(' '),
    associatedMedia: ge?.sourceUrl ? { '@type': 'MediaObject', contentUrl: ge.sourceUrl } : undefined,
  };

  return (
    <div className="min-h-[100dvh] bg-surface-raised text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="border-b border-line">
        <div className="mx-auto max-w-reading px-5 py-12">
          <div className="flex items-start gap-4">
            {ge?.coverUrl ? (
              <CoverImage src={ge.coverUrl} size={64} className="h-16 w-16" />
            ) : (
              <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-surface-sunken" />
            )}
            <div>
              {ge?.showTitle && <div className="mb-1 text-sm font-medium text-ink-muted">{ge.showTitle}</div>}
              <h1 className="text-xl font-semibold leading-tight tracking-tight">
                {conv.title} <span className="text-ink-muted font-normal text-lg">文字版</span>
              </h1>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                {platform && <span>{platform}</span>}
                {ge?.durationSec ? <span>{Math.round(ge.durationSec / 60)} 分钟</span> : null}
                {ge && ge.readCount > 1 ? <span>{ge.readCount} 人读过</span> : null}
                {ge?.sourceUrl && (
                  <a href={ge.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                    原链接
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-reading px-5 py-8 space-y-10">
        {insights.length > 0 && (
          <section>
            <h2 className="section-label mb-3">导读</h2>
            <ul className="space-y-2">
              {insights.map((t) => (
                <li key={t.id} className="flex gap-2.5 text-base leading-[1.7] text-ink-subtle">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-500">•</span>
                  <span>{truncateQuote(t.text, 160)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {quotes.length > 0 && (
          <section>
            <h2 className="section-label mb-3">金句</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {quotes.map((q) => {
                const ev = q.evidenceSpans[0];
                const speaker = ev?.turn?.participant?.name;
                return (
                  <div key={q.id} className="rounded-lg border border-line bg-surface-raised p-4">
                    <p className="text-base leading-relaxed">「{truncateQuote(q.text, 120)}」</p>
                    {(speaker || ev) && (
                      <div className="mt-2 flex items-center gap-2 text-2xs text-ink-muted">
                        {speaker ? <span>{speaker}</span> : null}
                        {ev?.startMs ? <span className="ml-2">{formatMs(ev.startMs)}</span> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-line p-10 text-center">
          <p className="mb-4 text-sm text-ink-muted">想读完整的带说话人文字版？</p>
          <Link
            href={`/read/${conversationId}`}
            className="inline-block rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-surface-raised hover:bg-ink transition-colors"
          >
            登录读全文
          </Link>
        </section>
      </main>
    </div>
  );
}

function truncateQuote(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
