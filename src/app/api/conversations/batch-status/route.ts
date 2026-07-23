/**
 * GET /api/conversations/batch-status?ids=id1,id2,... — Aggregate progress for a batch.
 *
 * Returns the status of every conversation id in the batch plus summary counts.
 * The client polls this every few seconds until completed + failed === total.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const PROCESSING_STATUSES = ['pending', 'processing', 'transcribing', 'transcribed'];

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];

  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'No ids provided' }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ success: false, error: 'Too many ids (max 100)' }, { status: 400 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, status: true },
  });

  const episodes = conversations.map((c) => ({
    id: c.id,
    title: c.title ?? '未命名',
    status: c.status,
    ready: c.status === 'completed',
  }));

  const completed = episodes.filter((e) => e.status === 'completed').length;
  const failed = episodes.filter((e) => e.status === 'failed').length;
  const processing = episodes.filter((e) => PROCESSING_STATUSES.includes(e.status)).length;
  const queued = episodes.filter((e) => e.status === 'pending').length;

  return NextResponse.json({
    success: true,
    total: episodes.length,
    completed,
    failed,
    processing,
    queued,
    episodes,
    // Done when nothing is still pending/processing.
    done: completed + failed === episodes.length,
  });
}
