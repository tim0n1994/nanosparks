/**
 * P4h: host fingerprint — distill "问法" (interviewing style), not "观点".
 *
 * The guest fingerprint (P3) distills claims; the HOST fingerprint distills the
 * structure of their questioning. Fields (PRD §2.2):
 *   openingPattern   — how they open (background / direct / personal)
 *   followupDepth    — avg follow-up chain length; when they stop
 *   followupTriggers — what kind of answer makes them dig (vague / numeric / counterintuitive / contradiction)
 *   rebuttalStrategy — direct challenge / third-party / counterexample / silence
 *   transitionPhrases — habitual connectors
 *
 * All extractable from the host's OWN turns (via SpeakerIdentity). Pure helpers
 * exported for testing; the DB-backed builder persists a HostFingerprint-shaped
 * JSON onto the PersonFingerprint.styleJson (host-style key) to avoid a new table.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';

// ── Pure helpers ──

/** Detect a question turn (ends with ?/？ or starts with a question word). */
const QUESTION_END = /[?？]\s*$/;
const QUESTION_STARTERS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'do you', 'are you',
  'can you', 'could you', 'would you', 'is it', 'have you', 'did you', 'so',
  '什么', '为什么', '怎么', '如何', '哪里', '哪个', '谁', '是不是', '能不能', '可不可以', '有没有', '是不是', '那你', '所以',
];
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (QUESTION_END.test(t)) return true;
  const low = t.toLowerCase();
  return QUESTION_STARTERS.some((s) => low.startsWith(s));
}

/** Vague-quantifier words that should trigger a host follow-up (PRD §3.2). */
const VAGUE_WORDS = ['很多', '不少', '挺', '蛮', '差不多', '大概', '有点', '一些',
  'a lot', 'many', 'quite', 'sort of', 'kind of', 'fairly', 'somewhat', 'around'];
export function hasVagueQuantifier(text: string): boolean {
  const low = text.toLowerCase();
  return VAGUE_WORDS.some((w) => low.includes(w));
}

/** Approximate follow-up chain length: a run of consecutive host questions. */
export function avgFollowupDepth(hostQuestionMask: boolean[]): number {
  // Count consecutive true-runs, average their lengths (chains of length>=2 only).
  const chains: number[] = [];
  let run = 0;
  for (const q of hostQuestionMask) {
    if (q) { run++; }
    else { if (run >= 2) chains.push(run); run = 0; }
  }
  if (run >= 2) chains.push(run);
  if (chains.length === 0) return 0;
  return Math.round((chains.reduce((a, b) => a + b, 0) / chains.length) * 10) / 10;
}

/** Classify an opening turn by its first sentence. */
export function classifyOpening(text: string): 'background' | 'direct' | 'personal' | 'other' {
  const t = text.trim().slice(0, 200).toLowerCase();
  if (!t) return 'other';
  if (/background|context|背景|之前|在上次|上次我们/.test(t)) return 'background';
  // Personal: opens with first-person stance (word-boundary "i" / 我 / 我觉得...).
  if (/^i\b|^i'|^我|^my\b|^我觉得|^我认为/.test(t.slice(0, 20))) return 'personal';
  if (isQuestion(text)) return 'direct';
  return 'other';
}

/** Extract habitual transition phrases (connectors at the start of host turns). */
const TRANSITION_PHRASES = [
  'so', 'okay', 'right', 'got it', 'i see', 'and then', 'moving on', 'let\'s talk about',
  '那', '那么', '好的', '对', '嗯', '接下来', '我们聊', '换个话题', '说到', '刚才',
];
export function transitionPhraseCounts(turnStarts: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of turnStarts) {
    const low = raw.trim().toLowerCase();
    for (const p of TRANSITION_PHRASES) {
      if (low.startsWith(p)) { counts[p] = (counts[p] ?? 0) + 1; break; }
    }
  }
  return counts;
}

// ── DB-backed build ──

export interface HostFingerprint {
  openingPattern: { background: number; direct: number; personal: number; other: number };
  followupDepth: number;
  followupTriggers: { vagueAnswerHits: number };
  rebuttalSignals: { challengeWords: number };
  transitionPhrases: Record<string, number>;
  questionRate: number; // questions per turn
  coverage: { hostTurns: number; questions: number };
}

const CHALLENGE_WORDS = ['but', 'however', 'really', 'are you sure', 'disagree',
  '但是', '可是', '真的吗', '确定吗', '不同意', '未必', '不一定'];

/**
 * Build the host fingerprint for a person Entity (must have host-role turns via
 * SpeakerIdentity). Persists it onto a fresh PersonFingerprint version with a
 * `host` marker in styleJson so the UI can render host vs guest differently.
 */
export async function buildHostFingerprint(entityId: string): Promise<HostFingerprint | null> {
  const turns = await prisma.turn.findMany({
    where: { participant: { role: 'host', speakerIdentities: { some: { entityId } } } },
    select: { id: true, text: true },
    orderBy: { turnIndex: 'asc' },
  });
  if (turns.length === 0) return null;

  const questionMask = turns.map((t) => isQuestion(t.text));
  const questions = questionMask.filter(Boolean).length;
  const opening = { background: 0, direct: 0, personal: 0, other: 0 };
  for (const t of turns.slice(0, 20)) opening[classifyOpening(t.text)]++;

  const host: HostFingerprint = {
    openingPattern: opening,
    followupDepth: avgFollowupDepth(questionMask),
    followupTriggers: { vagueAnswerHits: turns.filter((t) => hasVagueQuantifier(t.text)).length },
    rebuttalSignals: { challengeWords: turns.filter((t) => CHALLENGE_WORDS.some((w) => t.text.toLowerCase().includes(w))).length },
    transitionPhrases: transitionPhraseCounts(turns.map((t) => t.text)),
    questionRate: Math.round((questions / turns.length) * 1000) / 10,
    coverage: { hostTurns: turns.length, questions },
  };

  // Persist as a new PersonFingerprint version tagged host (so the product layer
  // can render host-style distinct from guest claim-fingerprint).
  const last = await prisma.personFingerprint.findFirst({
    where: { entityId }, orderBy: { version: 'desc' }, select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  await prisma.personFingerprint.create({
    data: {
      entityId,
      version,
      coreClaimsJson: toPrismaJson([]) as never,
      stanceMapJson: toPrismaJson({ kind: 'host', questionRate: host.questionRate }) as never,
      styleJson: toPrismaJson({ kind: 'host', host }) as never,
      lineageJson: toPrismaJson([]) as never,
      analogiesJson: toPrismaJson([]) as never,
      changesJson: toPrismaJson([]) as never,
      coverageJson: toPrismaJson(host.coverage) as never,
    },
  });

  logger.info('HostFingerprint built', { entityId, version, hostTurns: turns.length, questions });
  return host;
}
