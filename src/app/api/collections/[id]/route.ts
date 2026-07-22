/**
 * Collection detail API (PRD §C2: 专题集管理).
 * GET — collection + its items (highlights).
 * PATCH — rename / update visibility.
 * DELETE — delete collection (cascade items).
 *
 * Sub-path /items for add/remove:
 *   POST   /api/collections/:id/items  { highlightId }  — add highlight to collection
 *   DELETE /api/collections/:id/items?highlightId=...     — remove
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

async function requireUserId(): Promise<string | NextResponse> {
  if (!isValidClerkKey) return 'dev-user';
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  return userId;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const collection = await prisma.collection.findFirst({
    where: { id, userId },
    include: {
      items: {
        include: {
          highlight: { select: { id: true, note: true, conversationId: true, createdAt: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!collection) return NextResponse.json({ success: false, error: 'Collection not found' }, { status: 404 });
  return NextResponse.json({ success: true, collection });
}

const patchSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public']).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });

  // Scoped update: must own the collection.
  const updated = await prisma.collection.updateMany({
    where: { id, userId },
    data: parsed.data,
  });
  if (updated.count === 0) return NextResponse.json({ success: false, error: 'Collection not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const deleted = await prisma.collection.deleteMany({ where: { id, userId } });
  if (deleted.count === 0) return NextResponse.json({ success: false, error: 'Collection not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
