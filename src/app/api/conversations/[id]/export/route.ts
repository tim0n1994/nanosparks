/**
 * GET /api/conversations/:id/export?format=markdown — PRD §A3 导出 MD/Obsidian.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { conversationToMarkdown, exportFilename } from '@/lib/export/markdown';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const access = await requireConversationAccess(conversationId, 'read');
  if ('response' in access) return access.response;
  const format = new URL(request.url).searchParams.get('format') || 'markdown';

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      title: true,
      source: { select: { uri: true, platform: true } },
      globalEpisode: { select: { showTitle: true, durationSec: true } },
      participants: { select: { name: true, speakerLabel: true, role: true } },
    },
  });
  if (!conversation) {
    return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
  }

  const [tldr, quotes, turns] = await Promise.all([
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: { in: ['insight', 'decision'] } },
      orderBy: [{ confidence: 'desc' }],
      take: 6,
      select: { type: true, text: true },
    }),
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: 'insight' },
      orderBy: [{ confidence: 'desc' }],
      take: 6,
      select: { type: true, text: true },
    }),
    prisma.turn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      select: {
        turnIndex: true, startMs: true, endMs: true,
        text: true, cleanText: true,
        participant: { select: { name: true, speakerLabel: true } },
      },
    }),
  ]);

  if (format === 'json') {
    return NextResponse.json({
      success: true,
      conversation: {
        title: conversation.title,
        showTitle: conversation.globalEpisode?.showTitle ?? null,
        turns: turns.map((t) => ({ ...t, text: t.cleanText ?? t.text })),
        tldr,
        quotes,
        participants: conversation.participants,
      },
    });
  }

  const md = conversationToMarkdown({
    title: conversation.title ?? '未命名',
    showTitle: conversation.globalEpisode?.showTitle ?? null,
    sourceUrl: conversation.source?.uri ?? null,
    durationSec: conversation.globalEpisode?.durationSec ?? null,
    platform: conversation.source?.platform ?? null,
    participants: conversation.participants,
    tldr,
    quotes,
    turns: turns.map((t) => ({
      turnIndex: t.turnIndex,
      startMs: t.startMs,
      endMs: t.endMs,
      text: t.cleanText ?? t.text,
      speakerName: t.participant?.name ?? null,
      speakerLabel: t.participant?.speakerLabel ?? null,
    })),
  });

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(conversation.title ?? 'episode')}"`,
    },
  });
}
