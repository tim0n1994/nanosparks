/**
 * P4: stance-change (drift) detection.
 *
 * Finds where a person's stance on the SAME topic flipped across episodes, and
 * emits a dual-citation change record (before/after) for the stance timeline
 * (PRD §2.3 变化史 + §9.1 立场时间线). PRD §10 flags this as the most dangerous
 * metric — false positives are defamation-adjacent — so detection is conservative:
 *
 *   - cluster the person's claims by topic (embedding similarity in production;
 *     here a token-overlap bucket as a deterministic fallback)
 *   - within a cluster, sort by time; a "change" is when an earlier stance and a
 *     later stance on the same cluster differ in polarity (assert <-> oppose)
 *   - only emit when BOTH sides have a real claim with a timestamp (no inference)
 *   - never attribute motive; only present the two cited positions
 *
 * Pure helpers exported for testing. With single-episode data, every claim shares
 * one timestamp so no drift is detectable → changesJson stays empty (correct).
 */

/** A time-stamped claim with a stance usable for drift detection. */
export interface DriftClaim {
  id: string;
  text: string;
  stance: string; // assert | oppose | question | concede | neutral
  assertedAt: number; // epoch ms
  modality?: string | null; // §7.3: asserted | hedged | hypothetical | quoted | joking
}

export interface StanceChange {
  topicKey: string;
  before: { claimId: string; text: string; assertedAt: number; stance: string };
  after: { claimId: string; text: string; assertedAt: number; stance: string };
  /** qualitative label for the flip, never a motive attribution */
  kind: 'flip' | 'soften' | 'harden';
}

/** Normalize stance to a polarity in {-1, 0, +1} for comparison. */
export function stancePolarity(stance: string): number {
  const s = (stance ?? '').toLowerCase().trim();
  if (s === 'oppose' || s === 'object' || s === 'disagree') return -1;
  if (s === 'assert' || s === 'support' || s === 'agree') return 1;
  return 0; // question / concede / neutral / unknown
}

/**
 * Pure: bucket claims into topic clusters by token overlap (deterministic
 * fallback for embedding clustering). Two claims share a cluster if they share
 * >= minShared significant tokens. Returns a map of topicKey -> claims.
 */
export function clusterByTopic(
  claims: DriftClaim[],
  opts: { minShared?: number; minTokenLen?: number } = {},
): Map<string, DriftClaim[]> {
  const { minShared = 2, minTokenLen = 3 } = opts;
  const tokensOf = (text: string) =>
    new Set(text.toLowerCase().split(/[\s,，。.！!?？;；:：()（）]+/).filter((w) => w.length >= minTokenLen));

 const clusters: DriftClaim[][] = [];
  for (const c of claims) {
    const cTokens = tokensOf(c.text);
    let placed = false;
    for (const cluster of clusters) {
      const rep = cluster[0];
      const repTokens = tokensOf(rep.text);
      const shared = [...cTokens].filter((t) => repTokens.has(t)).length;
      if (shared >= minShared) {
        cluster.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([c]);
  }
  // Key each cluster by its earliest claim id (stable).
  const out = new Map<string, DriftClaim[]>();
  for (const cluster of clusters) {
    const sorted = [...cluster].sort((a, b) => a.assertedAt - b.assertedAt);
    out.set(sorted[0].id, sorted);
  }
  return out;
}

/**
 * Pure: detect stance changes within each topic cluster. A change requires:
 *   - >= 2 claims in the cluster
 *   - the earliest and latest have DIFFERENT non-zero polarity
 *   - the earliest.assertedAt < latest.assertedAt (strictly — same timestamp = no drift)
 * Conservative on purpose (PRD §10: false drift is the most dangerous metric).
 */
export function detectStanceChanges(
  claims: DriftClaim[],
): StanceChange[] {
  const clusters = clusterByTopic(claims);
  const changes: StanceChange[] = [];
  for (const [, members] of clusters) {
    if (members.length < 2) continue;
    // §7.3: only compare asserted stances — exclude quoted/hypothetical/joking
    // (those aren't the person's own position → would create false "立场翻转").
    const assertedMembers = members.filter((m) => !m.modality || m.modality === 'asserted' || m.modality === 'hedged');
    if (assertedMembers.length < 2) continue;
    const sorted = [...assertedMembers].sort((a, b) => a.assertedAt - b.assertedAt);
    const before = sorted[0];
    const after = sorted[sorted.length - 1];
    // Strict temporal separation — same timestamp (single episode) = no drift.
    if (before.assertedAt >= after.assertedAt) continue;
    const pb = stancePolarity(before.stance);
    const pa = stancePolarity(after.stance);
    if (pb === 0 || pa === 0) continue; // need a real stance on both sides
    if (pb === pa) continue; // no change
    changes.push({
      topicKey: before.id,
      before: { claimId: before.id, text: before.text, assertedAt: before.assertedAt, stance: before.stance },
      after: { claimId: after.id, text: after.text, assertedAt: after.assertedAt, stance: after.stance },
      kind: pb === 1 && pa === -1 ? 'flip' : pb === -1 && pa === 1 ? 'flip' : pa < pb ? 'soften' : 'harden',
    });
  }
  return changes;
}

/** Pure: false-positive rate of a detected-change set against a gold set (PRD §10). */
export function falsePositiveRate(
  detected: StanceChange[],
  goldTrueTopicKeys: Set<string>,
): number {
  if (detected.length === 0) return 0;
  const falsePositives = detected.filter((c) => !goldTrueTopicKeys.has(c.topicKey));
  return Math.round((falsePositives.length / detected.length) * 1000) / 10; // percent, 1dp
}
