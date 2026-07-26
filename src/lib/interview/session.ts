/**
 * P5a: interview session orchestrator.
 *
 * Ties together arc planner (topic order/time) + follow-up engine (press on weak
 * answers) + style layer (host transition phrases). Runs a simulated interview
 * where the AI host asks and a (caller-supplied) interviewee answers, producing
 * a readable transcript with AI-generated content explicitly marked (PRD §3.5:
 * no voice synthesis; text only; AI turns flagged so they are never re-ingested
 * as the host's real fingerprint — §3.4).
 *
 * The interviewee answerer is injected so this can be driven by a real user, a
 * guest fingerprint, or a test stub. The orchestrator itself is deterministic
 * given the inputs (LLM follow-ups are optional; default formulateFollowUp).
 */

import { planArc, type InterviewArc } from '@/lib/interview/arc-planner';
import { judgeAnswer, formulateFollowUp, type FollowupReason } from '@/lib/interview/followup-engine';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface InterviewTurn {
  role: 'host' | 'guest';
  text: string;
  /** PRD §3.5: AI-generated host turns are marked so consumers never confuse them with a real person. */
  aiGenerated: boolean;
  topicId?: string;
  /** If this host turn was a follow-up, the reason it was triggered. */
  followupReason?: FollowupReason;
}

export interface InterviewTranscript {
  turns: InterviewTurn[];
  arc: InterviewArc;
  /** Count of follow-ups the engine pressed (a quality signal). */
  followupsTriggered: number;
  /** PRD §3.4: guest answers are real and may be re-ingested; host turns are not. */
  reingestableGuestTurns: number;
}

/** Injected answerer: given a question + context, return the guest's answer. */
export type IntervieweeAnswerer = (ctx: {
  question: string;
  topicId: string;
  turnNumber: number;
}) => Promise<string>;

/** Injected host-style provider: a habitual transition phrase for naturalness. */
export type HostStyle = {
  transitionPhrase?: string;
  followupDepthP75?: number; // cap on follow-up chain length
};

/**
 * Run a simulated interview. For each arc topic: ask the seed question, get the
 * answer, judge it, follow up (up to followupDepthP75) until it passes or the
 * cap is hit, then move on. All host turns are aiGenerated=true.
 */
export async function runInterview(opts: {
  intervieweeEntityId: string;
  totalMinutes: number;
  answerer: IntervieweeAnswerer;
  hostStyle?: HostStyle;
}): Promise<InterviewTranscript> {
  const { intervieweeEntityId, totalMinutes, answerer } = opts;

  // Load the interviewee's latest fingerprint to drive the arc.
  const fp = await prisma.personFingerprint.findFirst({
    where: { entityId: intervieweeEntityId },
    orderBy: { version: 'desc' },
    select: { coreClaimsJson: true },
  });
  const arc = planArc({ fingerprint: fp ? { coreClaimsJson: fp.coreClaimsJson } : null, totalMinutes });

  // Load prior claims for contradiction detection (§3.2 trigger 3 — the differentiator).
  const priorClaims = await prisma.personClaim.findMany({
    where: { entityId: intervieweeEntityId },
    select: { text: true },
    take: 20,
  });

  const turns: InterviewTurn[] = [];
  const knownEntities: string[] = [];
  let followupsTriggered = 0;
  let turnNumber = 0;
  const followupCap = opts.hostStyle?.followupDepthP75 ?? 3;

  for (const topic of arc.topics) {
    // Seed question.
    turns.push({ role: 'host', text: topic.seedQuestion, aiGenerated: true, topicId: topic.id });
    let lastAnswer = await answerer({ question: topic.seedQuestion, topicId: topic.id, turnNumber: turnNumber++ });
    turns.push({ role: 'guest', text: lastAnswer, aiGenerated: false, topicId: topic.id });

    // Follow-up loop.
    let depth = 0;
    let decision = judgeAnswer({ question: topic.seedQuestion, answer: lastAnswer, priorClaims, knownEntities });
    while (decision.needsFollowup && depth < followupCap) {
      followupsTriggered++;
      const prefix = opts.hostStyle?.transitionPhrase ? `${opts.hostStyle.transitionPhrase}，` : '';
      const q = prefix + formulateFollowUp(decision.reason, decision.detail);
      turns.push({ role: 'host', text: q, aiGenerated: true, topicId: topic.id, followupReason: decision.reason });
      lastAnswer = await answerer({ question: q, topicId: topic.id, turnNumber: turnNumber++ });
      turns.push({ role: 'guest', text: lastAnswer, aiGenerated: false, topicId: topic.id });
      depth++;
      decision = judgeAnswer({ question: q, answer: lastAnswer, priorClaims, knownEntities });
    }
  }

  const reingestableGuestTurns = turns.filter((t) => t.role === 'guest').length;
  logger.info('Interview session completed', {
    intervieweeEntityId,
    topics: arc.topics.length,
    turns: turns.length,
    followupsTriggered,
  });

  return { turns, arc, followupsTriggered, reingestableGuestTurns };
}

/**
 * §3.4/§13.1: persist an AI interview as a SYNTHETIC conversation so the guest's
 * real answers can be re-ingested into their fingerprint (the flywheel), while the
 * synthetic conversation is excluded from cross-person comparisons of real podcasts.
 *
 * - conversation.isSynthetic = true, syntheticKind = 'ai_interview'
 * - host turns (aiGenerated) are NOT written as that host's speech
 * - guest turns ARE written, attributed to the interviewee's participant
 * Returns the synthetic conversationId.
 */
export async function persistSyntheticInterview(
  transcript: InterviewTranscript,
  opts: { workspaceId: string; corpusId: string; intervieweeEntityId: string; hostEntityId?: string },
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: {
      // synthetic markers (§13.1 isolation)
      isSynthetic: true,
      syntheticKind: 'ai_interview',
      title: `AI 访谈（合成）`,
      corpusId: opts.corpusId,
      status: 'transcribed',
    },
  });

  // Reuse the interviewee's existing participant if they have one in this corpus,
  // else create one. Host turns are NOT attributed to anyone (AI-generated).
  let guestParticipantId: string | null = null;
  const existingGuest = await prisma.participant.findFirst({
    where: {
      speakerIdentities: { some: { entityId: opts.intervieweeEntityId } },
      conversation: { corpusId: opts.corpusId },
    },
    select: { id: true },
  });
  if (existingGuest) {
    guestParticipantId = existingGuest.id;
  } else {
    const guest = await prisma.participant.create({
      data: { conversationId: conversation.id, name: 'guest', role: 'guest' },
    });
    guestParticipantId = guest.id;
    await prisma.speakerIdentity.create({
      data: { participantId: guest.id, entityId: opts.intervieweeEntityId, confidence: 1.0, method: 'manual' },
    }).catch(() => { /* idempotent */ });
  }

  let idx = 0;
  for (const turn of transcript.turns) {
    await prisma.turn.create({
      data: {
        conversationId: conversation.id,
        turnIndex: idx++,
        startMs: idx * 1000,
        endMs: idx * 1000 + 999,
        text: turn.text,
        // §3.4: only guest (real) answers get a participantId; host (AI) turns do not.
        participantId: turn.role === 'guest' ? guestParticipantId : null,
        attributionMethod: turn.role === 'guest' ? 'dialogue' : 'none',
        attributionConfidence: turn.role === 'guest' ? 1.0 : 0,
      },
    });
  }

  logger.info('Synthetic interview persisted', {
    conversationId: conversation.id,
    intervieweeEntityId: opts.intervieweeEntityId,
    guestTurns: transcript.reingestableGuestTurns,
  });
  return conversation.id;
}
