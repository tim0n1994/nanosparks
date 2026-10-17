import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireUser } from '@/lib/auth/roles';

export type ConversationAccess = { userId: string } | { response: NextResponse };

export async function requireConversationAccess(
  id: string,
  mode: 'read' | 'write',
): Promise<ConversationAccess> {
  const user = await requireUser();
  if ('unauthorized' in user) {
    return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      isSharedCache: true,
      corpus: { select: { workspace: { select: { clerkId: true } } } },
    },
  });
  if (!conversation) {
    return { response: NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 }) };
  }
  if (conversation.corpus.workspace.clerkId === user.userId || (mode === 'read' && conversation.isSharedCache)) {
    return user;
  }

  const admin = await requireAdmin();
  if ('userId' in admin && admin.userId === user.userId) return user;
  return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
}
