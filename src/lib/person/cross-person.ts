/**
 * P6: cross-person comparison (PRD §9.3).
 *
 * For a given topic/keyword, show the stance distribution across all persons in
 * a corpus — who is assert/oppose/neutral, each with a citation back to their
 * own claim. This is the infra-level view that only becomes possible once L0/L2
 * exist (each person's own attributed claims).
 *
 * Pure aggregation helpers exported for testing; the DB-backed comparator scans
 * all person Entities' PersonClaims for topic-relevant text.
 */

import { prisma } from '@/lib/prisma';
import { stancePolarity } from '@/lib/person/stance-drift';
import { normalizePersonName } from '@/lib/person/identity-resolver';

export interface PersonStance {
  entityId: string;
  name: string;
  stance: string;
  polarity: number; // -1, 0, +1
  claimText: string;
  claimId: string;
}

export interface CrossPersonView {
  topic: string;
  /** sorted: assert (+1) first, then neutral, then oppose (-1) — left-to-right spectrum */
  persons: PersonStance[];
  distribution: { assert: number; neutral: number; oppose: number };
}

/**
 * Pure: build the cross-person stance spectrum from per-person stances on a topic.
 * Orders persons by polarity descending (assert → neutral → oppose), matching the
 * PRD §9.3 "激进 ●  ●● ... 保守" left-to-right layout.
 */
export function buildStanceSpectrum(
  topic: string,
  stances: PersonStance[],
): CrossPersonView {
  const persons = [...stances].sort((a, b) => b.polarity - a.polarity);
  const distribution = { assert: 0, neutral: 0, oppose: 0 };
  for (const s of persons) {
    if (s.polarity > 0) distribution.assert++;
    else if (s.polarity < 0) distribution.oppose++;
    else distribution.neutral++;
  }
  return { topic, persons, distribution };
}

/**
 * Pure: does a claim text relate to a topic keyword? (token-substring match,
 * case-insensitive, supports multi-word topics).
 */
export function claimMatchesTopic(claimText: string, topic: string): boolean {
  const c = claimText.toLowerCase();
  const t = topic.trim().toLowerCase();
  if (!t) return false;
  // Match if the topic phrase appears, OR all of its significant tokens appear.
  if (c.includes(t)) return true;
  const tokens = t.split(/\s+/).filter((w) => w.length >= 2);
  return tokens.length > 0 && tokens.every((tok) => c.includes(tok));
}

/**
 * DB-backed: compare all persons in a workspace on a topic. Returns each person's
 * most relevant claim on that topic with its stance, for the §9.3 spectrum view.
 * Persons without a topic-relevant claim are omitted (no fabrication).
 */
export async function comparePersonsOnTopic(
  workspaceId: string,
  topic: string,
): Promise<CrossPersonView> {
  const persons = await prisma.entity.findMany({
    where: { workspaceId, type: 'person' },
    select: {
      id: true, canonicalName: true,
      // §13.1: exclude AI-interview (synthetic) conversations from the real-podcast
      // stance distribution — never mix synthetic products with real ones.
      personClaims: {
        where: {
          supersededAt: null,
          entity: { speakerIdentities: { some: { participant: { conversation: { isSynthetic: false } } } } },
        },
        select: { id: true, text: true, stance: true },
      },
    },
  });
  const stances: PersonStance[] = [];
  for (const p of persons) {
    const relevant = p.personClaims.find((c) => claimMatchesTopic(c.text, topic));
    if (!relevant) continue;
    stances.push({
      entityId: p.id,
      name: p.canonicalName,
      stance: relevant.stance,
      polarity: stancePolarity(relevant.stance),
      claimText: relevant.text,
      claimId: relevant.id,
    });
  }
  return buildStanceSpectrum(topic, stances);
}

/** Re-export so callers don't need the identity-resolver import for name matching. */
export { normalizePersonName };
