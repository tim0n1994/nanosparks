/**
 * Highlights API (C2) — 划句高亮 → 高亮库.
 *
 * POST creates a highlight anchored to a turn + char offsets (reuses the
 * EvidenceSpan offset semantics so a highlight is also a citable evidence span).
 * GET lists the caller's highlights for the conversation (the highlight library).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';

const createSchema = z.object({
  turnId: z.string().optional(),
  startOffset: z.number().int().min(0).default(0),
  endOffset: z.number().int().min(0).default(0),
  note: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public']).default('private'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { userId } = access;

  const highlights = await prisma.highlight.findMany({
    where: { conversationId, userId },
    orderBy: { createdAt: 'desc' },
    include: {
      turn: { select: { id: true, text: true, turnIndex: true, startMs: true, participant: { select: { name: true } } } },
    },
  });

  return NextResponse.json({ success: true, highlights });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { userId } = access;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const { turnId, startOffset, endOffset, note, visibility } = parsed.data;

  // Validate the turn belongs to this conversation before anchoring.
  if (turnId) {
    const turn = await prisma.turn.findFirst({
      where: { id: turnId, conversationId },
      select: { id: true },
    });
    if (!turn) {
      return NextResponse.json({ success: false, error: 'Turn not found in this conversation' }, { status: 404 });
    }
  }

  const highlight = await prisma.highlight.create({
    data: { userId, conversationId, turnId, startOffset, endOffset, note, visibility },
  });

  return NextResponse.json({ success: true, highlight });
}

/** DELETE a highlight (owner only). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { userId } = access;

  const { searchParams } = new URL(request.url);
  const highlightId = searchParams.get('highlightId');
  if (!highlightId) {
    return NextResponse.json({ success: false, error: 'highlightId required' }, { status: 400 });
  }

  // Scoped delete: must own it + belong to this conversation.
  const deleted = await prisma.highlight.deleteMany({
    where: { id: highlightId, userId, conversationId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ success: false, error: 'Highlight not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
