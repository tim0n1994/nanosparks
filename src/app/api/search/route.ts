/**
 * GET /api/search?q=&type=&corpusId=
 *
 * V2/T-V2-9: lightweight multi-table typeahead for the Cmd+K palette.
 * Groups results into four kinds: conversations (集), persons (Entity person),
 * concepts (Entity non-person), quotes (quote-type ThoughtUnits).
 *
 * Uses the existing FTS tsvector on ThoughtUnit.text + plain ILIKE on
 * Conversation/Entity (those tables are small and don't have FTS yet). Kept
 * deliberately cheap so typing is instant; the full hybrid RAG lives on Ask.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const LIMIT_PER_TYPE = 5;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const typeFilter = searchParams.get('type'); // optional: conversation|person|concept|quote
    const corpusId = searchParams.get('corpusId') || undefined;

    if (q.length < 1) {
      return NextResponse.json({ success: true, data: { results: [] } });
    }

    const tasks: Promise<unknown>[] = [];

    if (!typeFilter || typeFilter === 'conversation') {
      tasks.push(
        prisma.conversation
          .findMany({
            where: { title: { contains: q, mode: 'insensitive' }, ...(corpusId ? { corpusId } : {}) },
            select: { id: true, title: true, corpusId: true },
            take: LIMIT_PER_TYPE,
          })
          .then((rows) => ({ type: 'conversation' as const, items: rows.map((r) => ({ id: r.id, label: r.title ?? '(untitled)', href: `/read/${r.id}` })) })),
      );
    }
    if (!typeFilter || typeFilter === 'person') {
      tasks.push(
        prisma.entity
          .findMany({
            where: { type: 'person', canonicalName: { contains: q, mode: 'insensitive' } },
            select: { id: true, canonicalName: true, type: true },
            take: LIMIT_PER_TYPE,
          })
          .then((rows) => ({ type: 'person' as const, items: rows.map((r) => ({ id: r.id, label: r.canonicalName, href: `/person/${r.id}` })) })),
      );
    }
    if (!typeFilter || typeFilter === 'concept') {
      tasks.push(
        prisma.entity
          .findMany({
            where: { type: { not: 'person' }, canonicalName: { contains: q, mode: 'insensitive' } },
            select: { id: true, canonicalName: true, type: true },
            take: LIMIT_PER_TYPE,
          })
          .then((rows) => ({ type: 'concept' as const, items: rows.map((r) => ({ id: r.id, label: `${r.canonicalName} (${r.type})`, href: `/corpora/${r.id}` })) })),
      );
    }
    if (!typeFilter || typeFilter === 'quote') {
      tasks.push(
        (corpusId
          ? prisma.$queryRawUnsafe<Array<{ id: string; text: string; conversationId: string }>>(
              `SELECT tu.id, tu.text, tu."conversationId" FROM "ThoughtUnit" tu
               WHERE tu.search_tsv @@ plainto_tsquery('simple', $1)
               AND EXISTS (SELECT 1 FROM "Conversation" c WHERE c.id = tu."conversationId" AND c."corpusId" = $2::text)
               LIMIT $3`,
              q, corpusId, LIMIT_PER_TYPE,
            )
          : prisma.$queryRawUnsafe<Array<{ id: string; text: string; conversationId: string }>>(
              `SELECT tu.id, tu.text, tu."conversationId" FROM "ThoughtUnit" tu
               WHERE tu.search_tsv @@ plainto_tsquery('simple', $1)
               LIMIT $2`,
              q, LIMIT_PER_TYPE,
            )
        ).then((rows) => ({ type: 'quote' as const, items: rows.map((r) => ({ id: r.id, label: r.text.slice(0, 80), href: `/read/${r.conversationId}` })) })),
      );
    }

    const groups = (await Promise.allSettled(tasks))
      .filter((r): r is PromiseFulfilledResult<{ type: string; items: unknown[] }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((g) => g.items.length > 0);

    return NextResponse.json({ success: true, data: { results: groups } });
  } catch (error) {
    return NextResponse.json({ success: false, error: `Search failed: ${String(error)}` }, { status: 500 });
  }
}
