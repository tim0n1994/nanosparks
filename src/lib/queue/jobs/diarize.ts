/**
 * Diarize Job
 *
 * Runs speaker diarization on an audio asset using pyannote community-1.
 * Runs in parallel with the transcribe job — both consume the same audio.
 *
 * Output: SpeakerSegment[] persisted as DiarizationSegment rows (who spoke when),
 * which the normalize_turns job reads to attribute turns to speakers (L1 of the
 * person-distillation stack). Previously discarded — see PRD §0.0.
 */

import { prisma } from '@/lib/prisma';
import { PyannoteDiarizer } from '@/lib/transcription/diarizer';
import { logger } from '@/lib/logger';
import type { Prisma } from '@/generated/prisma/client';

interface DiarizeJobData {
  sourceId: string;
  conversationId?: string;
  episodeId?: string;
  mediaPath?: string;
  mediaKey?: string;
}

export async function processDiarizeJob(data: DiarizeJobData): Promise<void> {
  const { sourceId, conversationId, mediaPath, mediaKey } = data;

  logger.info('Diarize job started', { sourceId, conversationId });

  try {
    // Resolve audio path
    let audioPath = mediaPath;
    if (!audioPath && mediaKey) {
      // Read from storage
      const { createStorageProvider } = await import('@/lib/storage/provider');
      const storage = createStorageProvider();
      const buffer = await storage.get(mediaKey);
      audioPath = `/tmp/${mediaKey}`;
      const { writeFile } = await import('node:fs/promises');
      await writeFile(audioPath, buffer);
    }

    if (!audioPath) {
      throw new Error('No audio path or media key provided for diarization');
    }

    // Run diarization
    const diarizer = new PyannoteDiarizer();
    const result = await diarizer.diarize(audioPath);

    // Completion marker (always written, even for 0 segments) so normalize_turns
    // can stop polling. retentionPolicy is a back-compat marker; the
    // DiarizationSegment table is the source of truth.
    if (sourceId) {
      try {
        await prisma.source.update({
          where: { id: sourceId },
          data: { retentionPolicy: `diarized:${result.speakerCount}` },
        });
      } catch (e) {
        logger.warn('Failed to write diarize completion marker', { sourceId, error: String(e) });
      }
    }

    if (result.segments.length === 0) {
      logger.warn('Diarization returned no segments', { sourceId });
      return;
    }

    // Store diarization result on the conversation
    if (conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true },
      });

      if (conversation) {
        // Persist the full "who spoke when" timeline. normalize_turns reads this
        // table (NOT the turn table) to assign participantId per turn. Idempotent:
        // a re-run wipes and rewrites this conversation's segments.
        await prisma.diarizationSegment.deleteMany({ where: { conversationId } });
        if (result.segments.length > 0) {
          await prisma.diarizationSegment.createMany({
            data: result.segments.map((s) => ({
              conversationId,
              label: s.label,
              startMs: s.startMs,
              endMs: s.endMs,
              confidence: s.confidence ?? null,
            })),
          });
        }

        // Create/update participants based on diarization
        const existingParticipants = await prisma.participant.findMany({
          where: { conversationId },
        });

        const speakerLabels = [...new Set(result.segments.map((s) => s.label))];

        for (const label of speakerLabels) {
          const existing = existingParticipants.find((p) => p.speakerLabel === label);
          if (!existing) {
            await prisma.participant.create({
              data: {
                conversationId,
                name: label,
                speakerLabel: label,
                isResolved: false,
                confidence: 0.8,
              },
            });
          }
        }

        logger.info('Diarization stored', {
          conversationId,
          speakerCount: result.speakerCount,
          segments: result.segments.length,
        });
      }
    }
  } catch (error) {
    logger.error('Diarize job failed', { sourceId, error: String(error) });
    throw error;
  }
}
