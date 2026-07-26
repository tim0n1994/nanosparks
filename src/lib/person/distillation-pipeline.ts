/**
 * P-post: orchestrate the L0->L3 distillation chain for a conversation.
 *
 * After extraction (analyze.ts) has created named participants + ThoughtUnits,
 * this runs the four distillation stages so a person's fingerprint is built
 * automatically with each new episode — no manual scripts needed:
 *
 *   1. resolveConversationIdentities   (P0: Participant->Entity)
 *   2. mergeSpeakersForConversation     (P1: anonymous->named turn attribution)
 *   3. promotePersonClaims (per entity) (P2: PersonClaim, dual-temporal)
 *   4. buildPersonFingerprint (per entity) (P3: versioned thought fingerprint)
 *
 * Best-effort and non-fatal: each stage logs + swallows its own errors so a
 * failure in fingerprinting never breaks the extraction pipeline. The whole
 * chain is idempotent (re-runnable).
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { computeMetrics, admitToDistillation } from '@/lib/transcription/quality-gate';

/** Count character-level differences between original and corrected text. */
function countDiffs(a: string, b: string): number {
  // Simple positional diff count (good enough for a correction-rate proxy).
  const len = Math.max(a.length, b.length);
  let diffs = 0;
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? '') !== (b[i] ?? '')) diffs++;
  }
  return diffs;
}
import { resolveConversationIdentities } from '@/lib/person/identity-resolver';
import { mergeSpeakersForConversation } from '@/lib/person/merge-speakers';
import type { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { promotePersonClaims } from '@/lib/person/claim-promoter';
import { buildPersonFingerprint } from '@/lib/person/fingerprint-builder';
import { buildHostFingerprint } from '@/lib/person/host-fingerprint';

/**
 * Attribute ThoughtUnits to speakers via their EvidenceSpan's turn. Extraction
 * often leaves TU.participantId null even when turns are attributed; this fills
 * it from the first evidence span's turn so claim-promotion has attributed TUs.
 * Idempotent (skips TUs that already have a participantId).
 */
export async function attributeThoughtUnitsViaEvidence(conversationId: string): Promise<number> {
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversationId, participantId: null },
    select: {
      id: true,
      evidenceSpans: { select: { turn: { select: { participantId: true } } }, take: 1 },
    },
  });
  let remapped = 0;
  for (const tu of tus) {
    const pid = tu.evidenceSpans[0]?.turn?.participantId;
    if (pid) {
      await prisma.thoughtUnit.update({ where: { id: tu.id }, data: { participantId: pid } });
      remapped++;
    }
  }
  if (remapped > 0) {
    logger.info('Attributed ThoughtUnits to speakers via evidence', { conversationId, remapped });
  }
  return remapped;
}

export async function runDistillationForConversation(
  conversationId: string,
  opts: { client?: OpenAIClient | ClaudeClient } = {},
): Promise<void> {
  try {
    // §5.6 quality gate: never distill a conversation below the accuracy bar —
    // "看起来很像但错得理直气壮的画像" is worse than no profile. Falls back to T0-only.
    const turnsForGate = await prisma.turn.findMany({
      where: { conversationId },
      select: { endMs: true, participantId: true, attributionMethod: true, attributionConfidence: true, text: true, rawText: true },
    });
    // Coverage denominator must be EXOGENOUS (episode metadata), never derived
    // from the turns themselves — max(endMs)/max(endMs) was identically 1.0.
    const episode = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { globalEpisode: { select: { durationSec: true } } },
    });
    const realDurationMs = (episode?.globalEpisode?.durationSec ?? 0) * 1000;
    const turnEndMsMax = turnsForGate.reduce((m, t) => Math.max(m, t.endMs), 0);
    const attributed = turnsForGate.filter((t) => t.participantId !== null);
    // Only confidences a real attribution run produced count toward the median;
    // backfilled constants (method='backfill') would let the gate grade its own
    // hardcoded input.
    const realConfidences = attributed
      .filter((t) => t.attributionMethod !== null && t.attributionMethod !== 'backfill' && t.attributionConfidence !== null)
      .map((t) => t.attributionConfidence as number);
    const totalChars = turnsForGate.reduce((n, t) => n + t.text.length, 0);
    const correctedChars = turnsForGate.reduce((n, t) => {
      if (!t.rawText || t.rawText === t.text) return n;
      return n + Math.abs(t.rawText.length - t.text.length) + countDiffs(t.rawText, t.text);
    }, 0);
    const decision = admitToDistillation(computeMetrics({
      turnEndMsMax,
      durationMs: realDurationMs,
      turnCount: turnsForGate.length,
      attributedCount: attributed.length,
      attributionConfidences: realConfidences,
      correctedChars,
      totalChars,
    }));
    if (!decision.admitted) {
      logger.warn('Distillation skipped: conversation below quality gate (T0-only)', {
        conversationId,
        failures: decision.failures,
        metrics: decision.metrics,
      });
      return; // §5.6 discipline: do not distill below the bar
    }
    if (decision.unverified.length > 0) {
      // Admitted, but not on the strength of these metrics — say so loudly.
      logger.warn('Distillation admitted with UNVERIFIED metrics', {
        conversationId,
        unverified: decision.unverified,
        metrics: decision.metrics,
      });
    }

    // 1. L0 identity: link named participants to entities (creates person entities).
    const identities = await resolveConversationIdentities(conversationId);
    if (identities.entities.length === 0) {
      logger.info('Distillation: no named speakers to link; skipping chain', { conversationId });
      return;
    }

    // 2. L1 merge: attribute anonymous turns to named participants (LLM path).
    await mergeSpeakersForConversation(conversationId, opts).catch((e) => {
      logger.warn('Distillation: speaker-merge stage failed (continuing)', { conversationId, error: String(e) });
    });

    // 3. Attribute ThoughtUnits to their speaker via EvidenceSpan->Turn, so
    //    claim-promotion has attributed TUs to work from.
    await attributeThoughtUnitsViaEvidence(conversationId).catch((e) => {
      logger.warn('Distillation: TU attribution failed (continuing)', { conversationId, error: String(e) });
    });

    // 3+4. L2+L3 per person entity.
    for (const entityId of identities.entities) {
      await promotePersonClaims(entityId).catch((e) => {
        logger.warn('Distillation: claim-promotion failed for entity', { entityId, error: String(e) });
      });
      await buildPersonFingerprint(entityId).catch((e) => {
        logger.warn('Distillation: fingerprint build failed for entity', { entityId, error: String(e) });
      });
      // Hosts additionally get a 问法 fingerprint (distinct from guest claims).
      await buildHostFingerprint(entityId).catch((e) => {
        logger.warn('Distillation: host-fingerprint failed for entity', { entityId, error: String(e) });
      });
    }

    logger.info('Distillation chain completed for conversation', {
      conversationId,
      persons: identities.entities.length,
      linked: identities.linked,
    });
  } catch (error) {
    // Never let distillation break extraction.
    logger.error('Distillation chain failed (non-fatal)', { conversationId, error: String(error) });
  }
}
