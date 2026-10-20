/**
 * Normalize Turns Job
 *
 * Attributes each Turn to a speaker using the persisted DiarizationSegment
 * timeline (who spoke when). This is L1 of the person-distillation stack.
 *
 * Previously this job reverse-engineered diarization segments from turns that
 * already had a speakerLabel — a bootstrap deadlock that left ~98.4% of Turns
 * with participantId = null (see PRD §0.0). Now it reads the real timeline from
 * the DiarizationSegment table and updates participantId in place, preserving
 * Turn IDs / EvidenceSpans (safe to backfill already-analyzed episodes).
 *
 * FlowProducer runs diarize as a parallel sibling of transcribe, so this job may
 * start before diarize has written its segments; we bounded-poll the table (and
 * the diarize completion marker) to handle that race.
 */

import { prisma } from '@/lib/prisma';
import { assignSpeaker } from '@/lib/transcription/normalize-turns';
import { dialogueAttribution } from '@/lib/transcription/dialogue-attribution';
import { fuseDiarizationAndDialogue } from '@/lib/transcription/attribution-arbiter';
import { logger } from '@/lib/logger';
import type { SpeakerSegment } from '@/types/domain';

interface NormalizeTurnsJobData {
  sourceId?: string;
  conversationId?: string;
  episodeId?: string;
}

// diarize is a sibling job; pyannote on long audio can take minutes. Poll until
// segments appear OR the completion marker shows diarize finished.
const DIA_POLL_INTERVAL_MS = 5_000;
// 30s (was 10 min): in the inverted FlowProducer tree diarize completes BEFORE
// normalize starts, so the first poll already reflects diarize's final state.
// The long timeout only made sense under the old broken parallel-sibling model.
const DIA_POLL_TIMEOUT_MS = 30_000;

async function waitForDiarization(
  conversationId: string,
  sourceId?: string,
): Promise<{ segments: SpeakerSegment[]; diarizeRan: boolean }> {
  const deadline = Date.now() + DIA_POLL_TIMEOUT_MS;
  let warned = false;
  while (Date.now() < deadline) {
    const rows = await prisma.diarizationSegment.findMany({
      where: { conversationId },
      orderBy: { startMs: 'asc' },
    });
    if (rows.length > 0) {
      return {
        segments: rows.map((r) => ({
          label: r.label,
          startMs: r.startMs,
          endMs: r.endMs,
          confidence: r.confidence ?? undefined,
        })),
        diarizeRan: true,
      };
    }
    // No segments. If diarize already completed (marker set), it produced nothing
    // — stop immediately rather than burn the full timeout.
    if (sourceId) {
      const src = await prisma.source.findUnique({
        where: { id: sourceId },
        select: { retentionPolicy: true },
      });
      if (src?.retentionPolicy?.startsWith('diarized:')) {
        return { segments: [], diarizeRan: true };
      }
    }
    if (!warned) {
      logger.warn('normalize_turns waiting for diarize to populate segments', { conversationId, sourceId });
      warned = true;
    }
    await new Promise((r) => setTimeout(r, DIA_POLL_INTERVAL_MS));
  }
  return { segments: [], diarizeRan: false };
}

export async function processNormalizeTurnsJob(data: NormalizeTurnsJobData): Promise<void> {
  const { conversationId, sourceId } = data;

  if (!conversationId) {
    logger.warn('Normalize turns job: no conversationId, skipping');
    return;
  }

  logger.info('Normalize turns job started', { conversationId });

  try {
    // Read existing turns (created by transcribe job)
    const turns = await prisma.turn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      select: { id: true, startMs: true, endMs: true, participantId: true, text: true },
    });

    if (turns.length === 0) {
      logger.warn('No turns found for normalization', { conversationId });
      return;
    }

    // Read the real "who spoke when" timeline (bounded-poll for the sibling race).
    const { segments, diarizeRan } = await waitForDiarization(conversationId, sourceId);

    if (segments.length === 0) {
      // L1 attribution not possible for this conversation. Loud error — never
      // succeed silently (the "安静地成功了" pattern from PRD §0.0 was the root sin).
      logger.error('normalize_turns: no diarization segments; L1 attribution skipped', {
        conversationId,
        sourceId,
        diarizeRan,
        turns: turns.length,
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'transcribed', transcribedAt: new Date() },
      });
      return;
    }

    // Ensure a Participant row exists for every diarized speaker label.
    const labels = [...new Set(segments.map((s) => s.label))];
    const existing = await prisma.participant.findMany({ where: { conversationId } });
    const labelToParticipant = new Map<string, string>();
    for (const p of existing) {
      if (p.speakerLabel) labelToParticipant.set(p.speakerLabel, p.id);
    }
    for (const label of labels) {
      if (!labelToParticipant.has(label)) {
        const created = await prisma.participant.create({
          data: {
            conversationId,
            name: label,
            speakerLabel: label,
            isResolved: false,
            confidence: 0.8,
          },
        });
        labelToParticipant.set(label, created.id);
      }
    }

    // Attribute each turn by best-overlap with the timeline; update participantId
    // in place only where it changed (preserve Turn id / EvidenceSpans / Highlights).
    // §5.4 三源融合：A diarization ⊕ B dialogue（C LLM 仲裁为后续 pass，冲突集先记 method）。
    const dialogueHints = dialogueAttribution(
      turns.map((t) => ({ text: t.text, startMs: t.startMs, endMs: t.endMs, diarizationLabel: null })),
      labels,
    );
    let assigned = 0;
    let changed = 0;
    let unmatched = 0;
    const byMethod: Record<string, number> = { diarization: 0, dialogue: 0, llm: 0, none: 0 };
    for (const turn of turns) {
      const aLabel = assignSpeaker(turn.startMs, turn.endMs, segments);
      const hint = dialogueHints[turns.indexOf(turn)];
      const fused = fuseDiarizationAndDialogue(
        aLabel ? { label: aLabel, confidence: 0.9 } : null,
        hint,
      );
      const resolvedLabel = fused.label ?? aLabel ?? undefined;
      const participantId = resolvedLabel ? labelToParticipant.get(resolvedLabel) ?? null : null;
      const method = (fused.method || 'none') as 'diarization' | 'dialogue' | 'llm' | 'none';
      const confidence = participantId ? (fused.confidence || 0.9) : 0;
      byMethod[method] = (byMethod[method] ?? 0) + 1;
      if (participantId) assigned++;
      else unmatched++;
      // §5.4: always write method/confidence so null is visible on the dashboard.
      await prisma.turn.update({
        where: { id: turn.id },
        data: { participantId, attributionMethod: method, attributionConfidence: confidence },
      });
        changed++;
    }

    logger.info('Turns attributed', {
      conversationId,
      turns: turns.length,
      segments: segments.length,
      speakers: labels.length,
      assigned,
      changed,
      unmatched,
      byMethod,
    });

    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'transcribed', transcribedAt: new Date() },
    });
  } catch (error) {
    logger.error('Normalize turns job failed', { conversationId, error: String(error) });
    throw error;
  }
}
