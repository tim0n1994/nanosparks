/**
 * GET /api/person/:id
 *
 * V3/T-V3-4: Person Hub payload — profile (stats/style/relations/summary) +
 * opinion library (CanonicalClaims involving this person, grouped by topic, each
 * with stance + citation + timestamp + conversation link) + claim timeline.
 * Read-only; the Person Hub page consumes this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: entityId } = await params;

    const entity = await prisma.entity.findUnique({
      where: { id: entityId },
      include: { profile: true },
    });
    if (!entity || entity.type !== 'person') {
      return NextResponse.json({ success: false, error: 'Person not found' }, { status: 404 });
    }

    // Opinion library: CanonicalClaims whose entityIdsJson includes this entity.
    const claims = await prisma.canonicalClaim.findMany({
      where: { corpus: { workspaceId: entity.workspaceId } },
      select: {
        id: true,
        text: true,
        memberTuIdsJson: true,
        entityIdsJson: true,
        firstAssertedAt: true,
        lastAssertedAt: true,
        corpusId: true,
      },
    });
    const involving = claims.filter((c) => {
      const ids = Array.isArray(c.entityIdsJson) ? (c.entityIdsJson as unknown[]) : [];
      return ids.includes(entityId);
    });

    // Resolve member TU conversationIds for reader links (first member per claim).
    const allTuIds = involving.flatMap((c) =>
      Array.isArray(c.memberTuIdsJson) ? (c.memberTuIdsJson as string[]) : [],
    );
    const tus = allTuIds.length > 0
      ? await prisma.thoughtUnit.findMany({ where: { id: { in: allTuIds } }, select: { id: true, conversationId: true, stance: true } })
      : [];
    const tuById = new Map(tus.map((t) => [t.id, t]));

    const opinionLibrary = involving.map((c) => {
      const memberIds = Array.isArray(c.memberTuIdsJson) ? (c.memberTuIdsJson as string[]) : [];
      const firstMember = tuById.get(memberIds[0] ?? '');
      return {
        id: c.id,
        text: c.text,
        stance: firstMember?.stance ?? null,
        assertedAt: c.firstAssertedAt,
        conversationId: firstMember?.conversationId ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        entity: {
          id: entity.id,
          canonicalName: entity.canonicalName,
          aliasesJson: entity.aliasesJson,
        },
        profile: entity.profile,
        opinionLibrary,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: `Failed to load person: ${String(error)}` }, { status: 500 });
  }
}
