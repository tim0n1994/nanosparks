/**
 * GET /api/conversations/:id/turns
 *
 * Returns paginated transcript turns with speaker info and evidence anchors.
 * Supports cursor-based pagination.
 *
 * Query: ?cursor=<turnId>&limit=50
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const turns = await prisma.turn.findMany({
      where: { conversationId },
      include: {
        participant: {
          select: { id: true, name: true, role: true, speakerLabel: true, isResolved: true },
        },
        evidenceSpans: {
          select: { id: true, startMs: true, endMs: true, quote: true, thoughtUnitId: true },
        },
      },
      orderBy: { turnIndex: 'asc' },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = turns.length > limit;
    const items = hasMore ? turns.slice(0, limit) : turns;
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;

    return NextResponse.json({
      success: true,
      data: items,
      meta: {
        hasMore,
        nextCursor,
        count: items.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch turns' },
      { status: 500 },
    );
  }
}
