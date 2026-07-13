/**
 * Normalize Turns Job
 *
 * Merges ASR transcript segments with diarization speaker segments
 * to produce continuous per-speaker turns.
 *
 * Depends on both transcribe (word timestamps) and diarize (speaker segments)
 * having completed. In the FlowProducer job graph, this runs after transcribe.
 * If diarization results aren't available, falls back to assigning all turns
 * to SPEAKER_00 (as the existing transcribe job already does).
 */

import { prisma } from '@/lib/prisma';
import { normalizeTurns } from '@/lib/transcription/normalize-turns';
import { redactPii } from '@/lib/pii';
import { logger } from '@/lib/logger';
import type { Prisma } from '@/generated/prisma/client';

interface NormalizeTurnsJobData {
  sourceId?: string;
  conversationId?: string;
  episodeId?: string;
}

export async function processNormalizeTurnsJob(data: NormalizeTurnsJobData): Promise<void> {
  const { conversationId } = data;

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
      include: { participant: { select: { id: true, speakerLabel: true, name: true } } },
    });

    if (turns.length === 0) {
      logger.warn('No turns found for normalization', { conversationId });
      return;
    }

    // Read participants (created by diarize job) to get speaker segments
    const participants = await prisma.participant.findMany({
      where: { conversationId },
    });

    // Build diarization-like segments from participants
    // In a full implementation, the diarize job stores segments in a dedicated table;
    // here we use the existing turn data + participant speakerLabels as a proxy
    const diarizationSegments = turns
      .filter((t) => t.participant?.speakerLabel)
      .map((t) => ({
        label: t.participant!.speakerLabel!,
        startMs: t.startMs,
        endMs: t.endMs,
      }));

    // Build ASR segments from existing turns
    const asrSegments = turns.map((t) => ({
      startMs: t.startMs,
      endMs: t.endMs,
      text: t.text,
      speakerLabel: t.participant?.speakerLabel ?? t.participant?.name,
      words: t.wordsJson as unknown as Array<{ word: string; startMs: number; endMs: number }> | undefined,
    }));

    // Normalize: merge ASR + diarization into speaker turns
    const normalized = normalizeTurns(
      asrSegments,
      { segments: diarizationSegments, speakerCount: participants.length },
    );

    logger.info('Turns normalized', {
      conversationId,
      inputTurns: turns.length,
      outputTurns: normalized.length,
      speakers: new Set(normalized.map((t) => t.speakerLabel)).size,
    });

    // If normalization produced different turn boundaries, update the turns
    if (normalized.length !== turns.length) {
      // Delete existing turns and recreate from normalized
      await prisma.turn.deleteMany({ where: { conversationId } });

      // PII redact all texts
      const redactedTexts = await Promise.all(
        normalized.map((t) => redactPii(t.text)),
      );

      // Build participant lookup
      const participantByLabel = new Map(
        participants.map((p) => [p.speakerLabel, p.id]),
      );

      await prisma.turn.createMany({
        data: normalized.map((turn, idx) => ({
          conversationId,
          participantId: participantByLabel.get(turn.speakerLabel) ?? null,
          startMs: turn.startMs,
          endMs: turn.endMs,
          text: turn.text,
          cleanText: redactedTexts[idx].redactedText,
          wordsJson: turn.words ? (turn.words as unknown as Prisma.InputJsonValue) : undefined,
          confidence: turn.confidence,
          turnIndex: idx,
        })),
      });

      logger.info('Turns replaced with normalized turns', {
        conversationId,
        count: normalized.length,
      });
    }

    // Update conversation status
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'transcribed' },
    });
  } catch (error) {
    logger.error('Normalize turns job failed', { conversationId, error: String(error) });
    throw error;
  }
}
