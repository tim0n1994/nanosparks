/**
 * POST /api/admin/takedown — PRD §8 DMCA/下架流程.
 *
 * Takes down a public episode (removes publicSlug, deletes GlobalEpisode,
 * marks Conversation private). Used by admins for DMCA/copyright complaints.
 * Body: { conversationId, reason }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

const schema = z.object({
  conversationId: z.string(),
  reason: z.string().min(1).max(500),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }

  const { conversationId, reason } = parsed.data;

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, episodeKey: true, sourceId: true, isSharedCache: true },
  });

  if (!conv) {
    return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
  }

  // Remove public visibility: clear source publicSlug + delete GlobalEpisode.
  if (conv.sourceId) {
    await prisma.source.update({
      where: { id: conv.sourceId },
      data: { publicSlug: null },
    });
  }
  if (conv.episodeKey) {
    await prisma.globalEpisode.deleteMany({ where: { conversationId } }).catch(() => {});
  }
  // Mark conversation private (no longer shared cache).
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { isSharedCache: false, episodeKey: null },
  });

  await audit({
    action: 'delete',
    resourceType: 'conversation',
    resourceId: conversationId,
    metadata: { reason, takedown: true },
  });

  logger.info('Episode taken down', { conversationId, reason });
  return NextResponse.json({ success: true });
}
