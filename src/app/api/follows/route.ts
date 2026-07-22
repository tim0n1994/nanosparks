/**
 * Follows API (C3) — 关注节目/话题 → 周 digest.
 *
 * POST creates a follow (source or topic). GET lists the caller's follows.
 * A separate digest worker (RSS polling for followed sources → new episodes
 * auto-transcribe into the cache) consumes the Follow table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

const followSchema = z.object({
  targetType: z.enum(['source', 'topic']),
  targetId: z.string().min(1),
});

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
  const targetType = searchParams.get('targetType') || undefined;

  const follows = await prisma.follow.findMany({
    where: { userId, ...(targetType ? { targetType } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ success: true, follows });
}

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const parsed = followSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const { targetType, targetId } = parsed.data;

  // Idempotent: re-following a source/topic is a no-op upsert.
  const follow = await prisma.follow.upsert({
    where: { userId_targetType_targetId: { userId, targetType, targetId } },
    update: {},
    create: { userId, targetType, targetId },
  });

  return NextResponse.json({ success: true, follow });
}

export async function DELETE(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const targetType = searchParams.get('targetType');
  const targetId = searchParams.get('targetId');
  if (!targetType || !targetId) {
    return NextResponse.json({ success: false, error: 'targetType + targetId required' }, { status: 400 });
  }

  await prisma.follow.deleteMany({
    where: { userId, targetType, targetId },
  });
  return NextResponse.json({ success: true });
}
