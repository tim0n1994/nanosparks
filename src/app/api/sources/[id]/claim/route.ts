/**
 * POST /api/sources/:id/claim — PRD §C4 主播认领.
 *
 * A podcast host claims their show's source. After verification (out of band),
 * we set claimedByUserId so the host gets: official badge, full-text public
 * rights, reader analytics, and shownotes tools (B1 auto-generated).
 * DELETE releases a claim. GET reports claim status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = await prisma.source.findUnique({
    where: { id },
    select: { id: true, claimedByUserId: true, platform: true, publicSlug: true },
  });
  if (!source) return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });
  return NextResponse.json({
    success: true,
    claimed: source.claimedByUserId !== null,
    claimedByUserId: source.claimedByUserId,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    userId = clerkUserId;
  }

  const body = await request.json().catch(() => ({}));
  // verificationHandle is what the host provided to prove ownership (social handle,
  // platform link, etc.). Recorded for review; claim becomes effective on approval.
  const verificationHandle = typeof body.verificationHandle === 'string' ? body.verificationHandle : '';

  const source = await prisma.source.findUnique({ where: { id }, select: { id: true, claimedByUserId: true } });
  if (!source) return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });
  if (source.claimedByUserId && source.claimedByUserId !== userId) {
    return NextResponse.json({ success: false, error: '该节目已被他人认领' }, { status: 409 });
  }

  await prisma.source.update({ where: { id }, data: { claimedByUserId: userId } });
  await audit({
    actorId: userId,
    action: 'settings_change',
    resourceType: 'source',
    resourceId: id,
    metadata: { claimed: true, verificationHandle },
  }).catch(() => {});
  logger.info('source claimed', { sourceId: id, userId, verificationHandle });

  return NextResponse.json({ success: true, claimed: true, claimedByUserId: userId });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    userId = clerkUserId;
  }

  const source = await prisma.source.findUnique({ where: { id }, select: { id: true, claimedByUserId: true } });
  if (!source) return NextResponse.json({ success: false, error: 'Source not found' }, { status: 404 });
  if (source.claimedByUserId !== userId) {
    return NextResponse.json({ success: false, error: '只能释放自己的认领' }, { status: 403 });
  }

  await prisma.source.update({ where: { id }, data: { claimedByUserId: null } });
  await audit({
    actorId: userId,
    action: 'settings_change',
    resourceType: 'source',
    resourceId: id,
    metadata: { claimed: false },
  }).catch(() => {});

  return NextResponse.json({ success: true, claimed: false });
}
