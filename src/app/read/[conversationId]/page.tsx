/**
 * Reader page (A3) — the product life-line.
 *
 * SSRs the first viewport (Hero + TL;DR + 金句墙 + first chapter of turns),
 * then a client island handles chapter lazy-loading, the inline player, the
 * bilingual toggle, and reading-progress persistence.
 */

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { getLang, t } from '@/lib/i18n/getLang';
import { platformLabel } from '@/lib/resolvers';
import { deriveChapters } from '@/lib/reader/chapters';
import { createStorageProvider } from '@/lib/storage/provider';
import PublishPanel from '@/components/publish/PublishPanel';
import ReaderShell from '@/components/reader/ReaderShell';

export const dynamic = 'force-dynamic';

const TLDR_LIMIT = 5;
const QUOTE_LIMIT = 6;
const TURN_PAGE = 200;

export default async function ReadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) {
    if (access.response.status === 401) redirect('/sign-in');
    notFound();
  }
  const lang = getLang((await cookies()).toString());

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      title: true,
      corpusId: true,
      status: true,
      language: true,
      isSharedCache: true,
      episodeKey: true,
      source: { select: { uri: true, platform: true, mediaAssets: { select: { storageKey: true }, take: 1 } } },
      // A3: audioUrl is the enclosure/platform audio the inline player plays
      // (PRD: 播原始 enclosure/平台 URL). sourceUrl stays the copyright backlink.
      globalEpisode: { select: { coverUrl: true, showTitle: true, durationSec: true, readCount: true, sourceUrl: true, audioUrl: true } },
      participants: { select: { id: true, name: true, speakerLabel: true, role: true } },
    },
  });

  if (!conversation) notFound();

  // Parallel fetch of the reader payload.
  const [tldr, quotes, turnPage, topicNodes] = await Promise.all([
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: { in: ['insight', 'decision'] } },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: TLDR_LIMIT,
      select: { id: true, type: true, text: true },
    }),
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: 'insight' },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: QUOTE_LIMIT,
      select: { id: true, text: true, evidenceSpans: { select: { startMs: true, quote: true } } },
    }),
    prisma.turn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      take: TURN_PAGE + 1,
      select: {
        id: true,
        turnIndex: true,
        startMs: true,
        endMs: true,
        text: true,
        cleanText: true,
        translationJson: true,
        participantId: true,
        participant: { select: { id: true, name: true, speakerLabel: true } },
      },
    }),
    // A3 章节导航: topic graph nodes from the corpus graph (labels + earliest evidence ms).
    prisma.graphNode.findMany({
      where: { corpusId: conversation.corpusId, kind: 'topic' },
      select: { id: true, label: true, metadataJson: true },
      take: 30,
    }),
  ]);

  const hasMore = turnPage.length > TURN_PAGE;
  const turns = hasMore ? turnPage.slice(0, TURN_PAGE) : turnPage;

  const status = conversation.status;
  const ready = status === 'completed' || status === 'transcribed';

  // PRD §A3: MinIO presigned fallback for when the original audio source fails.
  let fallbackAudioUrl: string | null = null;
  const mediaAsset = conversation.source?.mediaAssets?.[0];
  if (mediaAsset?.storageKey) {
    try {
      const storage = createStorageProvider();
      fallbackAudioUrl = storage.getPublicUrl(mediaAsset.storageKey);
    } catch { /* storage not configured */ }
  }

  // Derive chapters (PRD §A3): topic graph signals → fallback to time windows.
  const topicSignals = topicNodes
    .map((n) => {
      const meta = (n.metadataJson ?? {}) as { startMs?: number; evidenceMs?: number };
      const startMs = typeof meta.startMs === 'number' ? meta.startMs : meta.evidenceMs;
      return typeof startMs === 'number' ? { label: n.label, startMs } : null;
    })
    .filter((t): t is { label: string; startMs: number } => t !== null);
  const chapters = deriveChapters(topicSignals, turns.map((t) => ({ turnIndex: t.turnIndex, startMs: t.startMs })));

  return (
    <ReaderShell
      key={conversation.id}
      chapters={chapters}
      conversation={{
        id: conversation.id,
        title: conversation.title || t('common.untitled', lang),
        status,
        ready,
        language: conversation.language ?? undefined,
        platform: conversation.source?.platform ?? null,
        platformLabel: conversation.source?.platform
          ? platformLabel(conversation.source.platform)
          : null,
        sourceUrl: conversation.source?.uri ?? null,
        coverUrl: conversation.globalEpisode?.coverUrl ?? null,
        showTitle: conversation.globalEpisode?.showTitle ?? null,
        durationSec: conversation.globalEpisode?.durationSec ?? null,
        readCount: conversation.globalEpisode?.readCount ?? null,
        audioUrl: conversation.globalEpisode?.audioUrl ?? null,
        fallbackAudioUrl,
        corpusId: conversation.corpusId,
      }}
      participants={conversation.participants}
      tldr={tldr}
      quotes={quotes.map((q) => ({
        id: q.id,
        text: q.text,
        timestampMs: q.evidenceSpans[0]?.startMs ?? null,
      }))}
      turns={turns.map((t) => ({
        id: t.id,
        turnIndex: t.turnIndex,
        startMs: t.startMs,
        endMs: t.endMs,
        text: t.cleanText ?? t.text,
        translationJson: t.translationJson as Record<string, string> | null,
        participantName: t.participant?.name ?? null,
        participantLabel: t.participant?.speakerLabel ?? null,
        participantId: t.participant?.id ?? null,
      }))}
      hasMoreTurns={hasMore}
      /* B2: publish panel — inside the reading column, above the footer, so it
         is not stranded below the fixed player at a different width. */
      publishSlot={ready ? <PublishPanel conversationId={conversationId} /> : null}
    />
  );
}
