/**
 * GET /api/conversations/:id/read
 *
 * Aggregates everything the A3 reader needs in one payload so the page can SSR
 * the first viewport and lazy-load the rest:
 *   - conversation meta (title, cover, show, sourceUrl, status, language)
 *   - participants (speaker -> name map)
 *   - thought units of type 'insight' (TL;DR + key points)
 *   - quote thought units (金句墙)
 *   - turns (paginated by chapter heuristic)
 *
 * PUT /api/conversations/:id/read  — upsert reading progress (resume hook).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { z } from 'zod';

const TLDR_LIMIT = 5;
const QUOTE_LIMIT = 6;
const TURN_PAGE = 200;

export async function GET(
 request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { searchParams } = new URL(request.url);
  const turnCursor = searchParams.get('cursor') || undefined;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      title: true,
      status: true,
      language: true,
      isSharedCache: true,
      source: { select: { uri: true, platform: true } },
      participants: { select: { id: true, name: true, speakerLabel: true, role: true, isResolved: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
  }

  // TL;DR + key points: the most confident insight/claim thought units.
  const [insights, quotes, turnPage] = await Promise.all([
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: { in: ['insight', 'decision'] } },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: TLDR_LIMIT,
      select: { id: true, type: true, text: true, confidence: true },
    }),
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: 'insight' },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }],
      take: QUOTE_LIMIT,
      select: {
        id: true,
        text: true,
        evidenceSpans: { select: { turnId: true, startMs: true, endMs: true, quote: true } },
      },
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
      ...(turnCursor ? { skip: 1, cursor: { id: turnCursor } } : {}),
    }),
  ]);

  const hasMore = turnPage.length > TURN_PAGE;
  const turns = hasMore ? turnPage.slice(0, TURN_PAGE) : turnPage;

  return NextResponse.json({
    success: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      language: conversation.language,
      isSharedCache: conversation.isSharedCache,
      sourceUrl: conversation.source?.uri ?? null,
      platform: conversation.source?.platform ?? null,
    },
    participants: conversation.participants,
    tldr: insights.map((t) => ({ id: t.id, type: t.type, text: t.text })),
    quotes: quotes.map((q) => ({
      id: q.id,
      text: q.text,
      evidence: q.evidenceSpans[0] ?? null,
    })),
    turns,
    pagination: { hasMore, nextCursor: hasMore ? turns[turns.length - 1]?.id : null },
  });
}

/** Upsert the caller's reading progress (A3 resume-read hook). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { userId } = access;

  const parsed = z.object({
    turnIndex: z.number().int().min(0).max(2_147_483_647).default(0),
    scrollRatio: z.number().finite().min(0).max(1).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const { turnIndex, scrollRatio } = parsed.data;
  const completedAt = scrollRatio !== undefined && scrollRatio >= 0.7 ? new Date() : undefined;

  const progress = await prisma.$transaction(async (tx) => {
    const saved = await tx.readingProgress.upsert({
      where: { userId_conversationId: { userId, conversationId } },
      update: { turnIndex, scrollRatio },
      create: { userId, conversationId, turnIndex, scrollRatio, completedAt },
    });
    if (!completedAt || saved.completedAt) return saved;
    await tx.readingProgress.updateMany({
      where: { userId, conversationId, completedAt: null },
      data: { completedAt },
    });
    return tx.readingProgress.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
    });
  });

  return NextResponse.json({ success: true, progress });
}
