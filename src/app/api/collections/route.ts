/**
 * Collections API (PRD §C2: Collection 专题集 — 跨播客按话题收集).
 *
 * GET — list the caller's collections.
 * POST — create a new collection (title + optional description + visibility).
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

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const includeItems = searchParams.get('include') === 'items';

  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    ...(includeItems ? { include: { items: { include: { highlight: true }, orderBy: { order: 'asc' as const } } } } : {}),
  });
  return NextResponse.json({ success: true, collections });
}

const createSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public']).default('private'),
});

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }

  const collection = await prisma.collection.create({
    data: { userId, ...parsed.data },
  });
  return NextResponse.json({ success: true, collection });
}
