/**
 * V2/T-V2-5: CanonicalClaim clustering.
 *
 * Collapses the corpus's claim/insight ThoughtUnits into semantically-equivalent
 * clusters (CanonicalClaims) so the L1 graph shows representative sentences
 * instead of every raw TU — a ~10x density reduction. Clustering is embedding
 * density (DBSCAN over thought-unit vectors), the representative is the member
 * nearest the cluster centroid, and first/lastAssertedAt come from member
 * evidence timestamps + conversation creation time (E4 time dimension).
 *
 * The centroid-selection + cluster-summary helpers are pure + unit-tested.
 */

import { prisma } from '@/lib/prisma';
import { toPrismaJson } from '@/lib/prisma-json';
import { logger } from '@/lib/logger';
import { DBSCAN } from 'density-clustering';

export interface CanonicalClaimDraft {
  text: string;
  memberTuIds: string[];
  firstAssertedAt: Date | null;
  lastAssertedAt: Date | null;
}

interface MemberLike {
  id: string;
  text: string;
  vector: number[];
  assertedAt: Date | null;
}

export function cosineDistance(a: number[], b: number[]): number {
/** True cosine distance (normalizes internally) — works on unit or raw vectors. */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  if (mag === 0) return 1; // treat zero-vectors as maximally distant
  return 1 - dot / mag;
}

/** Index of the member nearest the cluster centroid (representative sentence). */
export function pickCentroidRepresentative(members: { vector: number[] }[]): number {
  if (members.length === 1) return 0;
  const dim = members[0].vector.length;
  const centroid = new Array(dim).fill(0);
  for (const m of members) for (let i = 0; i < dim; i++) centroid[i] += m.vector[i];
  for (let i = 0; i < dim; i++) centroid[i] /= members.length;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < members.length; i++) {
    const d = cosineDistance(members[i].vector, centroid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Pure: turn DBSCAN index-clusters into CanonicalClaim drafts.
 * `clusterGroups` = array of arrays of indices into `members`; ungrouped members
 * (noise / singletons handled per `minClusterSize`) each become their own claim.
 */
export function summarizeClusters(
  members: MemberLike[],
  clusterGroups: number[][],
  minClusterSize = 1,
): CanonicalClaimDraft[] {
  const drafts: CanonicalClaimDraft[] = [];
  const claimed = new Set<number>();

  for (const group of clusterGroups) {
    if (group.length < minClusterSize) continue;
    const groupMembers = group.map((i) => members[i]);
    const repIdx = pickCentroidRepresentative(groupMembers);
    const rep = groupMembers[repIdx];
    const times = groupMembers.map((m) => m.assertedAt).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime());
    drafts.push({
      text: rep.text,
      memberTuIds: group.map((i) => members[i].id),
      firstAssertedAt: times[0] ?? null,
      lastAssertedAt: times[times.length - 1] ?? null,
    });
    for (const i of group) claimed.add(i);
  }
  // Singletons / noise → each becomes its own (single-member) claim so nothing is lost.
  for (let i = 0; i < members.length; i++) {
    if (claimed.has(i)) continue;
    const m = members[i];
    drafts.push({ text: m.text, memberTuIds: [m.id], firstAssertedAt: m.assertedAt, lastAssertedAt: m.assertedAt });
  }
  return drafts;
}

/**
 * Build (or rebuild) CanonicalClaims for a corpus. Idempotent: existing claims
 * for the corpus are replaced on each run (CanonicalClaims are a derived cache),
 * so re-running on the same data yields the same clusters without duplicates.
 */
export async function buildCanonicalClaims(
  corpusId: string,
  opts: { epsilon?: number; minPoints?: number } = {},
): Promise<{ clusters: number; members: number }> {
  const epsilon = opts.epsilon ?? 0.22; // cosine-distance radius (~cosine sim 0.78)
  const minPoints = opts.minPoints ?? 2;

  // claim/insight TUs with an evidence/conversation timestamp.
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversation: { corpusId }, type: { in: ['claim', 'insight'] } },
    select: {
      id: true,
      text: true,
      conversation: { select: { createdAt: true } },
      evidenceSpans: { select: { startMs: true }, take: 1 },
    },
  });
  if (tus.length === 0) {
    await prisma.canonicalClaim.deleteMany({ where: { corpusId } }).catch(() => {});
    return { clusters: 0, members: 0 };
  }

  // Fetch their embeddings (resource_type='thought_unit').
  const rows = await prisma.$queryRawUnsafe<Array<{ resource_id: string; embedding: string }>>(
    `SELECT resource_id, embedding::text AS embedding FROM embeddings
     WHERE resource_type = 'thought_unit' AND resource_id = ANY($1::text[])`,
    tus.map((t) => t.id),
  );
  const vecByText = new Map<string, number[]>();
  for (const r of rows) {
    try {
      const cleaned = r.embedding.replace(/^\[|\]$/g, '');
      vecByText.set(r.resource_id, cleaned.split(',').map(Number));
    } catch {
      /* skip unparseable */
    }
  }

  const members: MemberLike[] = tus
    .filter((t) => vecByText.has(t.id) && (vecByText.get(t.id)?.length ?? 0) > 0)
    .map((t) => ({
      id: t.id,
      text: t.text,
      vector: vecByText.get(t.id)!,
      assertedAt: t.conversation.createdAt,
    }));

  if (members.length === 0) {
    await prisma.canonicalClaim.deleteMany({ where: { corpusId } }).catch(() => {});
    return { clusters: 0, members: 0 };
  }

  const dataset = members.map((m) => m.vector);
  const dbscan = new DBSCAN();
  const groups = dbscan.run(dataset, epsilon, minPoints, cosineDistance);
  const drafts = summarizeClusters(members, groups, 1);

  // Replace derived claims for the corpus (idempotent rebuild).
  await prisma.canonicalClaim.deleteMany({ where: { corpusId } }).catch(() => {});
  for (const d of drafts) {
    await prisma.canonicalClaim.create({
      data: {
        corpusId,
        text: d.text.slice(0, 500),
        memberTuIdsJson: toPrismaJson(d.memberTuIds) as never,
        firstAssertedAt: d.firstAssertedAt,
        lastAssertedAt: d.lastAssertedAt,
      },
    });
  }

  logger.info('CanonicalClaims built', { corpusId, members: members.length, clusters: drafts.length });
  return { clusters: drafts.length, members: members.length };
}
