/**
 * GET /api/conversations/:id/comments — PRD §C4 高亮即评论.
 *
 * Returns public highlights (visibility='public') for a conversation, each
 * carrying the speaker + timestamp context (more precise than 小宇宙 comments).
 * This is the community "comment stream" gated by the C4 data gate.
 *
 * POST adds a public highlight-as-comment (same shape as highlights, but forced
 * public). Auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { evaluateCommunityGate } from '@/lib/community/gate';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  // C4 gate: comments only render when the community is unlocked.
  const gate = await evaluateCommunityGate();
  if (!gate.unlocked) {
    return NextResponse.json({ success: true, comments: [], unlocked: false, reasons: gate.reasons });
  }

  const highlights = await prisma.highlight.findMany({
    where: { conversationId, visibility: 'public' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      turn: {
        select: {
          id: true, text: true, startMs: true,
          participant: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    success: true,
    unlocked: true,
    comments: highlights.map((h) => ({
      id: h.id,
      userId: h.userId,
      note: h.note,
      createdAt: h.createdAt,
      context: h.turn
        ? {
            speakerName: h.turn.participant?.name ?? null,
            timestampMs: h.turn.startMs,
            quote: h.turn.text.slice(h.startOffset, h.endOffset || undefined),
          }
        : null,
    })),
  });
}

const postSchema = z.object({
  turnId: z.string(),
  startOffset: z.number().int().min(0).default(0),
  endOffset: z.number().int().min(0).default(0),
  note: z.string().min(1).max(500),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    userId = clerkUserId;
  }

  // C4 gate: can't post a comment until the community is unlocked.
  const gate = await evaluateCommunityGate();
  if (!gate.unlocked) {
    return NextResponse.json(
      { success: false, error: '社区功能尚未开放', unlocked: false, reasons: gate.reasons },
      { status: 403 },
    );
  }

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }

  // Validate the turn belongs to this conversation.
  const turn = await prisma.turn.findFirst({
    where: { id: parsed.data.turnId, conversationId },
    select: { id: true },
  });
  if (!turn) {
    return NextResponse.json({ success: false, error: 'Turn not found' }, { status: 404 });
  }

  const highlight = await prisma.highlight.create({
    data: {
      userId,
      conversationId,
      turnId: parsed.data.turnId,
      startOffset: parsed.data.startOffset,
      endOffset: parsed.data.endOffset,
      note: parsed.data.note,
      visibility: 'public', // highlight-as-comment is always public
    },
  });

  return NextResponse.json({ success: true, comment: highlight });
}
