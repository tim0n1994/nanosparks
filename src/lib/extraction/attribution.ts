/**
 * V1 (T-V1-2): Speaker attribution + argument stance resolution.
 *
 * The windowed-extraction pass now asks the model to label each ThoughtUnit with
 * the speaker tag it saw in the window (`participantLabel`) and an argumentative
 * `stance`. These pure helpers map that raw model output onto concrete
 * Participant rows + canonical stance values so the reader L0 visualizations
 * (swimlanes, argument-thread coloring) have real data.
 *
 * Kept dependency-free on purpose: it is unit-tested in
 * src/__tests__/attribution.test.ts and called from analyze.ts during ingest.
 */
import type { Stance } from '@/types/domain';

export interface ParticipantRef {
  id: string;
  name: string;
  speakerLabel?: string | null;
}

const CANONICAL_STANCES: Stance[] = ['assert', 'oppose', 'question', 'concede', 'neutral'];

/** Lowercase + trim + collapse internal whitespace, the comparison key. */
function norm(s: string | null | undefined): string {
  return (s ?? '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Map a free-form stance string (incl. synonyms / Chinese) onto the canonical
 * set. Unknown / empty → null (so we leave ThoughtUnit.stance null rather than
 * guessing, which keeps the argument-thread coloring honest).
 */
export function normalizeStance(raw: string | null | undefined): Stance | null {
  const t = norm(raw);
  if (!t) return null;
  if ((CANONICAL_STANCES as string[]).includes(t)) return t as Stance;
  if (t === 'agree' || t === 'support' || t === 'affirm') return 'assert';
  if (t === 'disagree' || t === 'refute' || t === 'counter' || t === 'challenge') return 'oppose';
  if (t === 'doubt' || t === 'ask' || t === 'wonder' || t === 'inquire') return 'question';
  if (t === 'yield' || t === 'admit' || t === 'agree_to_disagree') return 'concede';
  // Use specific compounds (not single chars) so 认为(assert) ≠ 承认(concede).
  if (t.includes('反驳') || t.includes('反对') || t.includes('不同意') || t.includes('驳斥') || t.includes('唱反')) return 'oppose';
  if (t.includes('质疑') || t.includes('怀疑') || t.includes('提问') || t.includes('追问') || t.includes('求证')) return 'question';
  if (t.includes('让步') || t.includes('妥协') || t.includes('认输') || t.includes('认错') || t.includes('承认') || t.includes('同意对方')) return 'concede';
  if (t.includes('中立') || t.includes('旁观')) return 'neutral';
  if (t.includes('主张') || t.includes('断言') || t.includes('坚持') || t.includes('认为') || t.includes('肯定')) return 'assert';
  return null;
}

/**
 * Resolve a raw speaker label/name produced by the model to a Participant.id.
 *
 * Three descending specificity tiers, each preferring the strongest signal:
 *   1. Exact participantLabel match (ASR tag e.g. "s1", "SPEAKER_00")
 *   2. Exact name match (e.g. "张三")
 *   3. Fuzzy: case-insensitive startswith / contains, canonicalizing common ASR
 *      prefixes (speaker_, spk_) so "Spk_01" matches "Speaker 01".
 *
 * Returns null when nothing matches — the caller leaves participantId null and
 * the TU still surfaces (just unattributed) instead of being mis-attributed.
 */
export function resolveParticipant(
  label: string | null | undefined,
  participants: ParticipantRef[],
): string | null {
  const l = norm(label);
  if (!l || participants.length === 0) return null;

  for (const p of participants) {
    if (norm(p.speakerLabel) === l) return p.id;
  }
  for (const p of participants) {
    if (norm(p.name) === l) return p.id;
  }

  // Canonical ASR form: "speaker" + digits, stripping separators and leading
  // zeros so "SPK_00", "speaker_00", "SPEAKER 0" all collapse to "speaker0".
  const asrKey = (s: string | null | undefined): string => {
    const n = norm(s);
    const m = n.match(/^(?:spk|speaker)[\s_-]*0*(\d+)$/);
    return m ? `speaker${m[1]}` : n;
  };
  const lCanon = asrKey(label);
  for (const p of participants) {
    const cands = [asrKey(p.speakerLabel), asrKey(p.name)];
    if (cands.includes(lCanon)) return p.id;
  }
  // Guard short labels ("s", "1") against spurious substring matches.
  if (l.length >= 2) {
    for (const p of participants) {
      const name = norm(p.name);
      const sl = norm(p.speakerLabel);
      if ((name.length >= 2 && name.startsWith(l)) || (sl.length >= 2 && sl.startsWith(l))) return p.id;
    }
    for (const p of participants) {
      const name = norm(p.name);
      if (name.length >= 2 && name.includes(l)) return p.id;
    }
  }
  return null;
}

/**
 * Build a lookup that maps raw model labels → Participant.id for a conversation,
 * so analyze.ts can resolve a TU stream without re-scanning per TU.
 */
export function buildParticipantIndex(participants: ParticipantRef[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of participants) {
    for (const key of [p.name, p.speakerLabel]) {
      const k = norm(key);
      if (k && !idx.has(k)) idx.set(k, p.id);
    }
  }
  return idx;
}
