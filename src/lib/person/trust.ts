/**
 * Trust algebra (architecture 2026-08 §3): a claim's trust is the PRODUCT of
 * per-stage confidences, never a checklist of per-stage ✅s. Five stages at
 * 0.95 each is 0.77 — the product tells the truth the checkmarks hide.
 *
 * Only factors we can genuinely ground are included:
 *   attribution   — did a real attribution run place this quote in this mouth?
 *   traceability  — does the evidence span actually anchor to a time in audio?
 *
 * Backfilled provenance and zero-timestamp spans (the fabrication signature of
 * the 2026-07-26 repair scripts) are scored low ON PURPOSE: low trust is not
 * hidden, it is surfaced and down-ranked. Pure + unit-tested.
 */

export interface TrustFactor {
  stage: 'attribution' | 'traceability';
  value: number; // 0..1
  basis: string; // human-readable justification
}

export interface ClaimTrust {
  score: number; // product of factor values, 2dp
  factors: TrustFactor[];
}

export interface EvidenceTurnInfo {
  attributionMethod: string | null;
  attributionConfidence: number | null;
}

export interface EvidenceSpanInfo {
  turnId: string | null;
  startMs: number;
  endMs: number;
  quote: string;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** How much to trust that this person actually said the evidence turn. */
export function attributionFactor(turn: EvidenceTurnInfo | null): TrustFactor {
  if (!turn) {
    return { stage: 'attribution', value: 0.4, basis: 'no evidence turn — attribution unverifiable' };
  }
  const method = turn.attributionMethod;
  if (method === null || method === 'backfill' || method === 'none') {
    return { stage: 'attribution', value: 0.5, basis: 'provenance unknown (backfilled/unlabelled attribution)' };
  }
  if (turn.attributionConfidence !== null) {
    const v = clamp01(turn.attributionConfidence);
    return { stage: 'attribution', value: v, basis: `${method} attribution, confidence ${v}` };
  }
  return { stage: 'attribution', value: 0.6, basis: `${method} attribution without recorded confidence` };
}

/** How much to trust that the quote anchors to a real moment in the audio. */
export function traceabilityFactor(span: EvidenceSpanInfo | null): TrustFactor {
  if (!span || !span.turnId) {
    return { stage: 'traceability', value: 0.3, basis: 'no evidence span — quote cannot be audited' };
  }
  if (span.startMs === 0 && span.endMs === 0) {
    // The single-shot extraction fallback wrote spans pointing at 0:00 with a
    // guessed turn — a link to the wrong second is worse than no link.
    return { stage: 'traceability', value: 0.3, basis: 'zero-timestamp span (backfill fabrication signature)' };
  }
  if ((span.quote ?? '').trim().length < 10) {
    return { stage: 'traceability', value: 0.6, basis: 'span has no substantive quote' };
  }
  return { stage: 'traceability', value: 0.95, basis: 'time-anchored quote' };
}

/** Product of the grounded factors. */
export function claimTrust(turn: EvidenceTurnInfo | null, span: EvidenceSpanInfo | null): ClaimTrust {
  const factors = [attributionFactor(turn), traceabilityFactor(span)];
  const score = factors.reduce((p, f) => p * f.value, 1);
  return { score: Math.round(score * 100) / 100, factors };
}
