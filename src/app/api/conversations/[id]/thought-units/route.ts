/**
 * GET /api/conversations/:id/thought-units
 *
 * V1/T-V1-3: feeds the reader L0 visualizations (argument thread, topic river,
 * speaker-lane attribution). Returns thought units with their first evidence
 * anchor (for an on-screen timestamp), participantId (attribution), and stance.
 *
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;
    const access = await requireConversationAccess(conversationId, 'read');
    if ('response' in access) return access.response;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    }

    const thoughtUnits = await prisma.thoughtUnit.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        text: true,
        stance: true,
        participantId: true,
        confidence: true,
        evidenceSpans: { select: { startMs: true, endMs: true, quote: true, turnId: true }, take: 1 },
      },
    });

    const data = thoughtUnits.map((tu) => ({
      id: tu.id,
      type: tu.type,
      text: tu.text,
      stance: tu.stance,
      participantId: tu.participantId,
      confidence: tu.confidence,
      // Earliest evidence anchor drives the on-screen timestamp + seek target.
      startMs: tu.evidenceSpans[0]?.startMs ?? null,
      endMs: tu.evidenceSpans[0]?.endMs ?? null,
      quote: tu.evidenceSpans[0]?.quote ?? null,
      turnId: tu.evidenceSpans[0]?.turnId ?? null,
    }));

    return NextResponse.json({ success: true, data, meta: { count: data.length } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch thought units: ${String(error)}` },
      { status: 500 },
    );
  }
}
