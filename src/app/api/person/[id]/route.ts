/**
 * GET /api/person/:id
 *
 * Person Hub payload. After the P0-P3 distillation stack, this prefers the
 * person's OWN attributed data over mention-based proxies:
 *   opinionLibrary  — PersonClaims (L2, attributed via SpeakerIdentity), with
 *                     evidence (turnId + startMs/endMs) so every claim traces
 *                     back to the exact spoken turn (auditable). Falls back to
 *                     CanonicalClaims (mention-based) only when L2 is empty.
 *   fingerprint     — latest PersonFingerprint (L3): coreClaims / stance / style
 *                     / lineage / coverage. Null if none built yet.
 *   quoteWall       — the person's OWN turns (via SpeakerIdentity), not turns
 *                     that merely mention their name (PRD §0.1 fix).
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

    // ── L2 opinion library: the person's OWN attributed PersonClaims ──
    const personClaims = await prisma.personClaim.findMany({
      where: { entityId },
      select: {
        id: true, text: true, stance: true, modality: true,
        firstAssertedAt: true, lastAssertedAt: true, sourceThoughtUnitId: true,
      },
      orderBy: { firstAssertedAt: 'desc' },
      take: 50,
    });
    // Resolve evidence (turn + ms) for each claim via its source ThoughtUnit's
    // first EvidenceSpan, so every claim traces to the exact spoken turn.
    const srcTuIds = personClaims.map((c) => c.sourceThoughtUnitId).filter(Boolean) as string[];
    const spansByTu = new Map<string, { turnId: string | null; startMs: number; endMs: number; quote: string; conversationId: string | null }>();
    if (srcTuIds.length > 0) {
      const spans = await prisma.evidenceSpan.findMany({
        where: { thoughtUnitId: { in: srcTuIds } },
        select: { thoughtUnitId: true, turnId: true, startMs: true, endMs: true, quote: true, turn: { select: { conversationId: true } } },
      });
      for (const s of spans) {
        if (!spansByTu.has(s.thoughtUnitId)) {
          spansByTu.set(s.thoughtUnitId, { turnId: s.turnId, startMs: s.startMs, endMs: s.endMs, quote: s.quote, conversationId: s.turn?.conversationId ?? null });
        }
      }
    }
    const opinionLibrary = personClaims.map((c) => ({
      id: c.id,
      text: c.text,
      stance: c.stance,
      modality: c.modality,
      assertedAt: c.firstAssertedAt,
      conversationId: spansByTu.get(c.sourceThoughtUnitId ?? '')?.conversationId ?? null,
      evidence: spansByTu.get(c.sourceThoughtUnitId ?? '') ?? null,
    }));

    // ── L3 fingerprint: latest version ──
    const fingerprint = await prisma.personFingerprint.findFirst({
      where: { entityId },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        coreClaimsJson: true, stanceMapJson: true, styleJson: true,
        lineageJson: true, coverageJson: true, builtAt: true,
      },
    });

    // ── Quote wall: the person's OWN turns (via SpeakerIdentity), not mentions ──
    const ownTurns = await prisma.turn.findMany({
      where: { participant: { speakerIdentities: { some: { entityId } } } },
      select: { id: true, text: true, conversationId: true, startMs: true, endMs: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    // Prefer longer turns (more substantive quotes).
    const quoteWall = ownTurns
      .map((t) => ({ id: t.id, text: t.text, conversationId: t.conversationId, startMs: t.startMs }))
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 8);

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
      fingerprint,
      quoteWall,
    },
  });
  } catch (error) {
    return NextResponse.json({ success: false, error: `Failed to load person: ${String(error)}` }, { status: 500 });
  }
}
