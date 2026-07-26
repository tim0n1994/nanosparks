/**
 * P2: L2 PersonClaim promotion.
 *
 * Promotes a person's OWN ThoughtUnits (type in {claim, insight}, stance=assert)
 * into PersonClaims with dual-temporal first/lastAssertedAt. Attribution flows
 * through SpeakerIdentity: a ThoughtUnit belongs to a Participant, the Participant
 * links to an Entity, so the claim is attributed to the real cross-episode person.
 *
 * Host-echoing is excluded: ThoughtUnits whose participant has role=host AND whose
 * modality is 'quoted' (host restating the guest) are NOT promoted — they are not
 * the host's own stance (PRD §2.3).
 *
 * The pure merge/normalization helpers are exported for testing.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

const CLAIM_TYPES = new Set(['claim', 'insight']);

/** Map an argument-mining stance to the PersonClaim stance vocabulary. */
export function normalizeStance(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase().trim();
  if (['assert', 'support', 'agree', 'concede'].includes(s)) return s === 'support' || s === 'agree' ? 'assert' : s;
  if (['oppose', 'object', 'disagree'].includes(s)) return 'oppose';
  if (['question', 'ask'].includes(s)) return 'question';
  if (['neutral', ''].includes(s)) return 'neutral';
  return s; // pass through unknown but normalized
}

/**
 * §7.2: when extraction leaves stance empty, infer it from the claim text.
 * A type=claim with no explicit stance is treated as 'assert' by default, but we
 * refine: question marks → question; negation/opposition words → oppose.
 * Pure + conservative (never over-confident; defaults to assert, the type already asserts).
 */
export function inferStanceFromText(text: string, type: string): string {
  const t = text.trim();
  if (!t) return 'neutral';
  const low = t.toLowerCase();
  // Question: ends with ? or is interrogative.
  if (/[?？]\s*$/.test(t) || /^(what|why|how|是否|能不能|会不会|是不是)/i.test(t)) return 'question';
  // Opposition requires an explicit disagreement marker aimed at a position.
  // Bare 不/错/never fire on a large share of ordinary Chinese assertions
  // ("差不多"、"这不是问题"), which turned the stance field into character-
  // frequency noise; "X 不应该/未必 Y" is the speaker asserting a (negative)
  // position, not opposing one — those stay 'assert'.
  if (
    /\b(disagree|oppose|object to)\b|is (just )?wrong|反对|不同意|不认同|不赞成|我不认为|我不觉得|是错的|是错误的|是不对的/.test(low) ||
    /不对[的。！!，,\s]*$/.test(t) // "……不对" as a verdict; NOT bare 不 (see above)
  ) {
    return 'oppose';
  }
  // Concession: "I used to think X but now..." / "虽然...但是"
  if (/i used to|previously|曾经|以前.*现在|虽然.*但是|admit|承认/.test(low)) return 'concede';
  // Default for a claim/insight: it's an assertion.
  return 'assert';
}

/**
 * Pure: decide whether a ThoughtUnit should be promoted to a PersonClaim for the
 * given person. Requires a claim/insight type, an assert-like stance, and a real
 * (non-host-echo) modality. Anonymous TUs (no participant) never promote.
 */
export function shouldPromoteToPersonClaim(tu: {
  type: string;
  stance?: string | null;
  participantId?: string | null;
  participantRole?: string | null;
  modality?: string | null;
}): boolean {
  if (!tu.participantId) return false;
  if (!CLAIM_TYPES.has(tu.type)) return false;
  // §7.2/§7.3 modality gating: only asserted/hedged stances are the person's own.
  // hypothetical/joking/quoted are not real positions and must not feed drift.
  if (tu.modality === 'hypothetical' || tu.modality === 'joking' || tu.modality === 'quoted') return false;
  // A type=claim/insight is itself an assertion. Stance only EXCLUDES explicit
  // non-assert stances (oppose/question). Extraction often leaves stance empty;
  // absent/neutral is treated as an assertion (the type already asserts it).
  const stance = normalizeStance(tu.stance);
  if (stance === 'oppose' || stance === 'question') return false;
  return true;
}

export interface PromotePersonClaimsResult {
  entityId: string;
  promoted: number;
  skipped: number;
  firstAssertedAt: string | null;
  lastAssertedAt: string | null;
}

/**
 * DB-backed: rebuild PersonClaims for a person Entity from their attributed
 * ThoughtUnits. Idempotent: deletes this entity's existing claims then re-promotes
 * (claims are a derived projection, safe to rebuild). Dual-temporal uses the
 * conversation createdAt of the asserting turn as the time dimension (PRD E4
 * approximates with conversation time; exact utterance timestamp is in EvidenceSpan).
 */
export async function promotePersonClaims(entityId: string): Promise<PromotePersonClaimsResult> {
  // Load the person's ThoughtUnits via their linked Participants, with the
  // conversation time for the dual-temporal dimension.
  const tus = await prisma.thoughtUnit.findMany({
    where: {
      participant: { speakerIdentities: { some: { entityId } } },
    },
    select: {
      id: true,
      type: true,
      text: true,
      stance: true,
      modality: true,
      evidenceType: true,
      polarity: true,
      createdAt: true,
      conversation: { select: { createdAt: true } },
      participant: { select: { role: true } },
    },
  });

  const promoted = tus.filter((tu) =>
    shouldPromoteToPersonClaim({
      type: tu.type,
      stance: tu.stance,
      participantId: 'linked', // we already filtered by SpeakerIdentity above
      participantRole: tu.participant?.role ?? null,
      modality: tu.modality,
    }),
  );

  const skipped = tus.length - promoted.length;
  const times = promoted
    .map((t) => t.conversation.createdAt.getTime())
    .sort((a, b) => a - b);
  const firstAssertedAt = times.length ? new Date(times[0]) : null;
  const lastAssertedAt = times.length ? new Date(times[times.length - 1]) : null;

  // Idempotent rebuild.
  await prisma.personClaim.deleteMany({ where: { entityId } });
  if (promoted.length > 0) {
    await prisma.personClaim.createMany({
      data: promoted.map((tu) => ({
        entityId,
        sourceThoughtUnitId: tu.id,
        text: tu.text,
        // §7.2: extraction 常留空 stance，这里用文本启发式补全（inferStanceFromText）。
        stance: tu.stance ? normalizeStance(tu.stance) : inferStanceFromText(tu.text, tu.type),
        modality: tu.modality ?? 'asserted',
        evidenceType: tu.evidenceType,
        polarity: tu.polarity,
        firstAssertedAt,
        lastAssertedAt,
      })),
    });
  }

  logger.info('PersonClaims promoted', {
    entityId,
    candidateTus: tus.length,
    promoted: promoted.length,
    skipped,
    firstAssertedAt: firstAssertedAt?.toISOString() ?? null,
    lastAssertedAt: lastAssertedAt?.toISOString() ?? null,
  });

  return {
    entityId,
    promoted: promoted.length,
    skipped,
    firstAssertedAt: firstAssertedAt?.toISOString() ?? null,
    lastAssertedAt: lastAssertedAt?.toISOString() ?? null,
  };
}
