/**
 * Collection items API (PRD §C2: 向专题集添加/移除高亮).
 * POST   { highlightId }   — add a highlight to the collection (idempotent upsert)
 * DELETE ?highlightId=...  — remove
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

const addSchema = z.object({ highlightId: z.string().min(1) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: collectionId } = await params;
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  // Verify ownership of the collection.
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
  if (!collection) return NextResponse.json({ success: false, error: 'Collection not found' }, { status: 404 });

  const body = await request.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });

  // Verify the highlight belongs to the user.
  const highlight = await prisma.highlight.findFirst({
    where: { id: parsed.data.highlightId, userId },
    select: { id: true },
  });
  if (!highlight) return NextResponse.json({ success: false, error: 'Highlight not found' }, { status: 404 });

  // Compute next order.
  const maxOrder = await prisma.collectionItem.aggregate({
    where: { collectionId },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? -1) + 1;

  // Idempotent upsert (unique [collectionId, highlightId]).
  const item = await prisma.collectionItem.upsert({
    where: { collectionId_highlightId: { collectionId, highlightId: parsed.data.highlightId } },
    update: {},
    create: { collectionId, highlightId: parsed.data.highlightId, order },
  });

  return NextResponse.json({ success: true, item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: collectionId } = await params;
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const highlightId = new URL(request.url).searchParams.get('highlightId');
  if (!highlightId) return NextResponse.json({ success: false, error: 'highlightId required' }, { status: 400 });

  // Scoped via collection ownership.
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId }, select: { id: true } });
  if (!collection) return NextResponse.json({ success: false, error: 'Collection not found' }, { status: 404 });

  await prisma.collectionItem.deleteMany({ where: { collectionId, highlightId } });
  return NextResponse.json({ success: true });
}
