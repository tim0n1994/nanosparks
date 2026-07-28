/**
 * POST /api/highlights/:id/card — PRD §C2 一键生成金句卡（复用 B1）.
 *
 * Converts a highlight into a B1 quote card: loads the highlight + its turn
 * context (speaker, show, timestamp), builds a CardSpec via buildQuoteCard, and
 * returns the card spec (the client renders or downloads the PNG via renderCardPng).
 *
 * ?format=png renders the card server-side (satori + resvg, AIGC label embedded)
 * and returns the image directly — a download link needs no client rendering.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { buildQuoteCard, renderCardPng } from '@/lib/publish/cards';
import type { ThoughtUnitLike } from '@/lib/publish/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: highlightId } = await params;
  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    userId = clerkUserId;
  }

  const highlight = await prisma.highlight.findUnique({
    where: { id: highlightId },
    include: {
      turn: {
        select: {
          id: true, text: true, startMs: true,
          participant: { select: { name: true } },
          conversation: {
            select: { globalEpisode: { select: { showTitle: true } } },
          },
        },
      },
    },
  });

  if (!highlight || highlight.userId !== userId) {
    return NextResponse.json({ success: false, error: 'Highlight not found' }, { status: 404 });
  }

  const speakerName = highlight.turn?.participant?.name ?? undefined;
  const showTitle = highlight.turn?.conversation?.globalEpisode?.showTitle ?? undefined;
  const startMs = highlight.turn?.startMs;
  const quoteText = highlight.note || highlight.turn?.text.slice(highlight.startOffset, highlight.endOffset || undefined) || '';

  const quoteUnit: ThoughtUnitLike = {
    id: highlight.id,
    text: quoteText,
    speaker: speakerName,
    startMs,
  };
  const card = buildQuoteCard(quoteUnit, showTitle);

  const format = new URL(request.url).searchParams.get('format');
  if (format === 'png') {
    try {
      const png = await renderCardPng(card);
      return new NextResponse(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
      });
    } catch {
      return NextResponse.json({ success: false, error: 'Card rendering failed' }, { status: 500 });
    }
  }
  return NextResponse.json({ success: true, card });
}
