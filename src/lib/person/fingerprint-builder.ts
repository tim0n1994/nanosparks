/**
 * P3: L3 PersonFingerprint — versioned aggregation of a person's thought fingerprint.
 *
 * Pulls from L1 (the person's own turns, via SpeakerIdentity) and L2 (PersonClaims)
 * and produces:
 *   coreClaims  — claims ranked by recurrence × evidence-weighted confidence
 *   stanceMap   — {topic: {position, drift, citations}}
 *   style       — evidence-type distribution + hedge-rate + concession-rate
 *                 (declared sourceTypes[] so multi-source fusion never mixes
 *                 "pressured" talk with "polished" writing — PRD §2.4)
 *   lineage     — entities repeatedly cited by this person
 *   analogies   — signature metaphors (source domain → vehicle)
 *   changes     — stance flips across episodes (needs multi-episode data; empty for one)
 *   coverage    — episodeCount / wordCount / timeSpanMs
 *
 * Versioned: each build writes a new (entityId, version) row. Pure helpers exported.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';
import { detectStanceChanges } from '@/lib/person/stance-drift';

// ── Pure helpers (unit-tested) ──

/** Evidence type → weight for ranking core claims. Experiential/data rank higher. */
const EVIDENCE_WEIGHT: Record<string, number> = {
  experiential: 1.0,
  data: 0.9,
  authority: 0.7,
  analogy: 0.6,
  none: 0.4,
};

/**
 * Pure: rank claims into "core" by recurrence × evidence weight. Highest first.
 * recurrence = number of times asserted (PersonClaims sharing source TU cluster);
 * here approximated by claim count per deduplicated text bucket.
 */
export function rankCoreClaims(
  claims: Array<{ id: string; text: string; evidenceType: string | null; polarity: number | null }>,
  opts: { limit?: number } = {},
): Array<{ claimId: string; text: string; recurrence: number; evidenceType: string; score: number }> {
  const limit = opts.limit ?? 12;
  // Bucket by normalized text (collapse near-duplicates of the same claim).
  const buckets = new Map<string, { text: string; items: typeof claims }>();
  for (const c of claims) {
    const key = normalizeClaimText(c.text);
    const b = buckets.get(key);
    if (b) b.items.push(c);
    else buckets.set(key, { text: c.text, items: [c] });
  }
  const ranked = [...buckets.values()].map((b) => {
    const evType = (b.items.find((i) => i.evidenceType)?.evidenceType ?? 'none');
    const recurrence = b.items.length;
    const avgPol = b.items.reduce((n, i) => n + (i.polarity ?? 0.5), 0) / b.items.length;
    const score = recurrence * EVIDENCE_WEIGHT[evType] * Math.max(0.1, avgPol);
    return {
      claimId: b.items[0].id,
      text: b.text,
      recurrence,
      evidenceType: evType,
      score: Math.round(score * 1000) / 1000,
    };
  });
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Normalize a claim sentence for dedup: lowercase, collapse whitespace, strip trailing punct. */
export function normalizeClaimText(text: string): string {
  // trim first so trailing-punct stripping sees punctuation at the actual end.
  return text.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[。.!?！？,，、:;；：]+$/g, '').trim();
}

/** Pure: evidence-type distribution as percentages. */
export function evidenceTypeDistribution(
  evidenceTypes: Array<string | null>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const e of evidenceTypes) {
    const k = e ?? 'none';
    counts[k] = (counts[k] ?? 0) + 1;
    total++;
  }
  if (total === 0) return { none: 0 };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = Math.round((v / total) * 1000) / 10;
  return out;
}

/**
 * Pure: hedge-rate = fraction of turns beginning with a hedging qualifier
 * (PRD §2.4: a "pressed" vs "polished" style signature; declared sourceTypes).
 */
const HEDGE_PREFIXES = [
  'i think', 'i feel', 'maybe', 'perhaps', 'probably', 'sort of', 'kind of',
  '我觉得', '可能', '也许', '大概', '算是', '有点',
];
export function hedgeRate(turnTexts: string[]): number {
  if (turnTexts.length === 0) return 0;
  let hedged = 0;
  for (const t of turnTexts) {
    const low = t.trim().toLowerCase();
    if (HEDGE_PREFIXES.some((p) => low.startsWith(p))) hedged++;
  }
  return Math.round((hedged / turnTexts.length) * 1000) / 10; // percent, 1 dp
}

// ── DB-backed build ──

export interface BuildFingerprintResult {
  entityId: string;
  version: number;
  coreClaims: number;
  coverage: { episodeCount: number; wordCount: number; timeSpanMs: number };
}

/**
 * Build (and persist) the next version of a person's fingerprint. Reads L1+L2,
 * writes a new PersonFingerprint row. Returns the new version number. Safe on a
 * person with one episode (drift/changes arrays simply stay empty).
 */
export async function buildPersonFingerprint(entityId: string): Promise<BuildFingerprintResult> {
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { id: true, canonicalName: true, type: true },
  });
  if (!entity || entity.type !== 'person') {
    throw new Error(`Entity ${entityId} is not a person (or not found)`);
  }

  // L2: this person's claims.
  const claims = await prisma.personClaim.findMany({
    where: { entityId },
    select: { id: true, text: true, stance: true, modality: true, evidenceType: true, polarity: true, firstAssertedAt: true, lastAssertedAt: true, sourceThoughtUnitId: true },
  });
  const coreClaims = rankCoreClaims(claims).map((c) => ({
    ...c,
    citations: claimsForText(c.text, claims),
  }));

  // L1: this person's turns (via SpeakerIdentity).
  const turns = await prisma.turn.findMany({
    where: { participant: { speakerIdentities: { some: { entityId } } } },
    select: { id: true, text: true, startMs: true, endMs: true, conversationId: true, conversation: { select: { createdAt: true } } },
    orderBy: { turnIndex: 'asc' },
  });
  const turnTexts = turns.map((t) => t.text);
  const wordCount = turnTexts.reduce((n, t) => n + t.length, 0); // char count as CJK proxy
  const episodeSet = new Set(turns.map((t) => t.conversationId));
  const times = turns.map((t) => t.conversation.createdAt.getTime()).sort((a, b) => a - b);
  const timeSpanMs = times.length ? times[times.length - 1] - times[0] : 0;
  const coverage = { episodeCount: episodeSet.size, wordCount, timeSpanMs };

  // Style: evidence-type distribution + hedge rate. Declared sourceTypes: only
  // talk (pressured) contributed here, per PRD §2.4 (no writing mixed in yet).
  const style = {
    evidenceTypeDist: evidenceTypeDistribution(claims.map((c) => c.evidenceType)),
    hedgeRate: hedgeRate(turnTexts),
    concessionRate: 0, // TODO: derived from stance=concede count when extraction populates stance
    sourceTypes: ['talk'],
  };

  // Stance map: group claims by stance (no topic extraction yet → group by stance vocab).
  const stanceMap: Record<string, { count: number; citations: { claimId: string; text: string }[] }> = {};
  for (const c of claims) {
    const k = c.stance || 'assert';
    if (!stanceMap[k]) stanceMap[k] = { count: 0, citations: [] };
    stanceMap[k].count++;
    if (stanceMap[k].citations.length < 5) stanceMap[k].citations.push({ claimId: c.id, text: c.text.slice(0, 120) });
  }

  // Lineage: entities mentioned in the person's turns (who they cite). Best-effort:
  // match entity canonicalNames/aliases against turn text.
  const mentioned = await prisma.entityMention.findMany({
    where: { conversationId: { in: [...episodeSet] } },
    select: { entityId: true, entity: { select: { canonicalName: true, type: true } } },
  });
  const lineageCounts = new Map<string, { name: string; count: number }>();
  for (const m of mentioned) {
    if (m.entityId === entityId) continue;
    const cur = lineageCounts.get(m.entityId);
    if (cur) cur.count++;
    else lineageCounts.set(m.entityId, { name: m.entity.canonicalName, count: 1 });
  }
  const lineage = [...lineageCounts.entries()]
    .map(([id, v]) => ({ entityId: id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Analogies + changes: empty for now (need metaphor extraction P3-ext + multi-episode for changes P4).
  const analogiesJson: unknown[] = [];
  // Stance changes (P4): detect drift across the person's time-stamped claims.
  // Conservative — only emits on strict temporal separation + real stance on both
  // sides. Single-episode data yields no drift (correct).
  const driftClaims = claims.map((c) => ({
    id: c.id,
    text: c.text,
    stance: c.stance,
    modality: c.modality,
    assertedAt: c.firstAssertedAt ? c.firstAssertedAt.getTime() : 0,
  }));
  const changesJson = detectStanceChanges(driftClaims);

  // Next version number.
  const lastVersion = await prisma.personFingerprint.findFirst({
    where: { entityId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (lastVersion?.version ?? 0) + 1;

  await prisma.personFingerprint.create({
    data: {
      entityId,
      version,
      coreClaimsJson: toPrismaJson(coreClaims) as never,
      stanceMapJson: toPrismaJson(stanceMap) as never,
      styleJson: toPrismaJson(style) as never,
      lineageJson: toPrismaJson(lineage) as never,
      analogiesJson: toPrismaJson(analogiesJson) as never,
      changesJson: toPrismaJson(changesJson) as never,
      coverageJson: toPrismaJson(coverage) as never,
    },
  });

  logger.info('PersonFingerprint built', {
    entityId,
    name: entity.canonicalName,
    version,
    coreClaims: coreClaims.length,
    episodes: coverage.episodeCount,
    wordCount,
  });

  return { entityId, version, coreClaims: coreClaims.length, coverage };
}

function claimsForText(text: string, claims: Array<{ id: string; text: string; firstAssertedAt: Date | null; lastAssertedAt: Date | null }>) {
  const key = normalizeClaimText(text);
  return claims
    .filter((c) => normalizeClaimText(c.text) === key)
    .map((c) => ({ claimId: c.id, first: c.firstAssertedAt, last: c.lastAssertedAt }))
    .slice(0, 5);
}
