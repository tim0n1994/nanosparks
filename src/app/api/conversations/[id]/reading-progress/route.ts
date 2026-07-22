/**
 * GET /api/conversations/:id/reading-progress — PRD §A3 续读提示.
 *
 * Returns the caller's last reading position for this conversation so the
 * reader can show a "继续阅读" prompt on revisit (留存钩子). null when none.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

export async function GET(
  _request: NextRequest,
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

  const progress = await prisma.readingProgress.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { turnIndex: true, scrollRatio: true, completedAt: true, updatedAt: true },
  });

  return NextResponse.json({ success: true, progress });
}
