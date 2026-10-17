/**
 * GET /api/conversations/:id/reading-progress — PRD §A3 续读提示.
 *
 * Returns the caller's last reading position for this conversation so the
 * reader can show a "继续阅读" prompt on revisit (留存钩子). null when none.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const { userId } = access;

  const progress = await prisma.readingProgress.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { turnIndex: true, scrollRatio: true, completedAt: true, updatedAt: true },
  });

  return NextResponse.json({ success: true, progress });
}
