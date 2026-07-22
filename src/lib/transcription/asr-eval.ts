/**
 * ASR quality evaluation (PRD §A2 退出标准: 中文 fixture WER/DER 对比).
 *
 * Pure-logic WER (word error rate) + DER (diarization error rate) to regress
 * Paraformer output against a labeled fixture without GPU/network.
 * WER: Levenshtein over tokens (CJK → per-char). DER: NIST-style time overlap.
 */

export interface ReferenceSegment {
  startMs: number;
  endMs: number;
  speakerLabel: string;
}

export interface HypothesisSegment {
  startMs: number;
  endMs: number;
  speakerLabel: string;
}

/** Tokenize for WER: CJK → per-char, else whitespace split. Pure logic. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (/[\u4e00-\u9fff]/.test(word)) {
      for (const ch of word) tokens.push(ch);
    } else {
      tokens.push(word);
    }
  }
  return tokens;
}

/** Levenshtein edit distance between two token arrays. Pure logic. */
export function editDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Word Error Rate = edits / reference length. Returns 0..1 (0 = perfect). */
export function wer(reference: string, hypothesis: string): number {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

/**
 * Diarization Error Rate (NIST-style time overlap).
 * DER = (confusion + FA + MISS) / total_ref_speech. Pure logic.
 */
export function der(reference: ReferenceSegment[], hypothesis: HypothesisSegment[]): number {
  if (reference.length === 0) return 0;

  const boundaries = new Set<number>();
  for (const s of [...reference, ...hypothesis]) {
    boundaries.add(s.startMs);
    boundaries.add(s.endMs);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  let confusion = 0;
  let falseAlarm = 0;
  let miss = 0;
  let totalRef = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    const dur = t1 - t0;
    if (dur <= 0) continue;

    const refSpeaker = reference.find((s) => s.startMs <= t0 && s.endMs >= t1)?.speakerLabel;
    const hypSpeaker = hypothesis.find((s) => s.startMs <= t0 && s.endMs >= t1)?.speakerLabel;

    if (refSpeaker) {
      totalRef += dur;
      if (!hypSpeaker) miss += dur;
      else if (hypSpeaker !== refSpeaker) confusion += dur;
    } else if (hypSpeaker) {
      falseAlarm += dur;
    }
  }

  if (totalRef === 0) return 0;
  return (confusion + falseAlarm + miss) / totalRef;
}

export interface AsrEvalResult {
  wer: number;
  der: number;
}

/** Evaluate a hypothesis against a reference fixture. */
export function evaluateFixture(args: {
  referenceText: string;
  hypothesisText: string;
  referenceSpeakers: ReferenceSegment[];
  hypothesisSpeakers: HypothesisSegment[];
}): AsrEvalResult {
  return {
    wer: wer(args.referenceText, args.hypothesisText),
    der: der(args.referenceSpeakers, args.hypothesisSpeakers),
  };
}
