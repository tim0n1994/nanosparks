/**
 * POST /api/person/:id/claim
 *
 * V3/T-V3-6: person claim (host identity verification). Extends the existing
 * sources/[id]/claim pattern to persons. Verification of identity (social OAuth,
 * email-domain, RSS control) is out of scope for this slice and stubbed to
 * "manual review pending" — this records the claim intent and flips
 * PersonProfile.claimed once an admin confirms. On claim, the verified owner
 * gains content-correction / chat-toggle / takedown rights.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entityId } = await params;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      select: { type: true, profile: true },
    });
    if (!entity || entity.type !== 'person') {
      return NextResponse.json({ success: false, error: 'Person not found' }, { status: 404 });
    }
    if (entity.profile?.claimed) {
      return NextResponse.json({ success: false, error: 'This person is already claimed' }, { status: 409 });
    }

    // Record claim intent (pending verification). Upsert the profile row.
    const profile = await prisma.personProfile.upsert({
      where: { entityId },
      create: { entityId, displayName: entityId, claimed: false, claimedByUserId: userId, chatEnabled: false },
      update: { claimedByUserId: userId },
    });

    logger.info('Person claim submitted (pending verification)', { entityId, userId });
    return NextResponse.json({
      success: true,
      data: {
        entityId,
        status: 'pending_verification',
        profileId: profile.id,
        message: '认领请求已提交，等待身份核验通过后即可管理人物页与对话开关。',
      },
    });
  } catch (error) {
    logger.error('Person claim failed', { error: String(error) });
    return NextResponse.json({ success: false, error: `Claim failed: ${String(error)}` }, { status: 500 });
  }
}
