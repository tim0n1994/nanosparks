/**
 * P0: L0 cross-episode speaker identity — Participant ↔ Entity.
 *
 * Participant is scoped to ONE conversation; Entity is the real, cross-episode
 * person. This resolver links a Participant (who must carry a resolved name +
 * role) to an Entity, creating the person Entity if none exists in the
 * conversation's workspace yet. The result is a SpeakerIdentity row with a
 * confidence and provenance signals.
 *
 * Named participants only: anonymous SPEAKER_00/01 cannot be linked by name and
 * require either a voiceprint (P1) or an intra-conversation merge into a named
 * participant (see mergeAnonymousSpeakers). Identity resolution here reuses the
 * entity resolver's normalization so names canonicalize consistently with the
 * rest of the extraction pipeline.
 *
 * Pure helpers (normalizePersonName, linkConfidence) are exported for testing.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { normalizeEntityName } from '@/lib/entity/resolver';

/** A speaker is "named" (linkable) if it isn't an anonymous diarization label. */
export function isNamedSpeaker(name: string | null | undefined): boolean {
  const n = normalizePersonName(name);
  if (!n) return false;
  // pyannote/whisper anonymous labels: SPEAKER_00, speaker_0, SPEAKERS_00, etc.
  if (/^speaker[s_]?[\s_]*\d+$/i.test(name ?? '')) return false;
  if (n === 'unknown') return false;
  return true;
}

/** Normalize a person's display name for matching. Falls back to the raw trim. */
export function normalizePersonName(name: string | null | undefined): string {
  // Reuse entity normalization (lowercase, NFKC, strip punctuation/whitespace).
  const base = normalizeEntityName(name);
  return base;
}

// ── §7.1 三信号融合（分数级融合 + 不确定带 0.60–0.85）──
export const SIGNAL_WEIGHTS = { voiceprint: 0.45, metadata: 0.35, text: 0.20 };

/**
 * Pure: fuse the three L0 signals into a score 0..1.
 *   score = w_v·cos(voiceprint) + w_m·metaMatch + w_t·textMatch
 * Band: ≥0.85 auto-link | 0.60–0.85 human review | <0.60 new Entity.
 * The review band MUST exist with a UI (PRD §7.1) — auto-merge at the floor is the
 * most expensive error (poisons the whole profile).
 */
export function fuseIdentitySignals(signals: {
  voiceCos?: number | null;
  metaMatch?: boolean;
  textMatch?: boolean;
}): { score: number; method: string; band: 'auto' | 'review' | 'new' } {
  const v = signals.voiceCos ?? null;
  const score =
    (v != null ? SIGNAL_WEIGHTS.voiceprint * Math.max(0, v) : 0) +
    (signals.metaMatch ? SIGNAL_WEIGHTS.metadata : 0) +
    (signals.textMatch ? SIGNAL_WEIGHTS.text : 0);
  let method = 'fused';
  if (v != null && !signals.metaMatch && !signals.textMatch) method = 'voiceprint';
  else if (signals.metaMatch && v == null && !signals.textMatch) method = 'metadata';
  else if (signals.textMatch && v == null && !signals.metaMatch) method = 'text';
  const band = score >= 0.85 ? 'auto' : score >= 0.60 ? 'review' : 'new';
  return { score: Math.round(score * 1000) / 1000, method, band };
}

/**
 * Confidence in a Participant→Entity link, given the signals available.
 * Pure: deterministic, testable without the DB.
 */
export function linkConfidence(signals: {
  nameMatch: boolean;
  roleKnown?: boolean;
  voiceprint?: number | null; // cosine similarity 0..1, or null if absent
}): number {
  // Start from the strongest available signal. A voiceprint match dominates.
  if (signals.voiceprint != null) return Math.min(1, 0.7 + signals.voiceprint * 0.3);
  let c = 0;
  if (signals.nameMatch) c += 0.85;
  if (signals.roleKnown) c += 0.1; // role disambiguates same-name host/guest across shows
  return Math.min(0.95, c); // name+role alone never exceeds 0.95 (P1 voiceprint/LLM can push to 1.0)
}

export interface ResolveParticipantIdentityResult {
  participantId: string;
  entityId: string;
  confidence: number;
  method: 'name' | 'existing';
}

/**
 * Link a single Participant to a person Entity. Creates the Entity when none
 * exists in the workspace, then upserts the SpeakerIdentity. Idempotent.
 * Returns null for anonymous speakers (caller should route them to a merge /
 * voiceprint step instead).
 */
export async function resolveParticipantIdentity(
  participantId: string,
): Promise<ResolveParticipantIdentityResult | null> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      name: true,
      role: true,
      speakerLabel: true,
      conversation: { select: { corpus: { select: { workspaceId: true } } } },
    },
  });
  if (!participant) return null;
  if (!isNamedSpeaker(participant.name)) {
    logger.warn('Skipping anonymous speaker for identity resolution (needs voiceprint/merge)', { participantId, name: participant.name });
    return null;
  }

  const workspaceId = participant.conversation.corpus.workspaceId;
 const nameKey = normalizePersonName(participant.name);

  // Find an existing person entity whose canonical or alias name matches.
  const candidates = await prisma.entity.findMany({
    where: { workspaceId, type: 'person' },
    select: { id: true, canonicalName: true, aliasesJson: true },
  });
  let entity = candidates.find((e) => {
    if (normalizeEntityName(e.canonicalName) === nameKey) return true;
    const aliases = Array.isArray(e.aliasesJson) ? (e.aliasesJson as unknown[]) : [];
    return aliases.some((a) => normalizeEntityName(String(a)) === nameKey);
  });
  let method: 'name' | 'existing' = 'existing';

  if (!entity) {
    // Create the person entity, seeded with role as metadata for host/guest context.
    entity = await prisma.entity.create({
      data: {
        workspaceId,
        type: 'person',
        canonicalName: participant.name,
        metadataJson: participant.role ? { role: participant.role } : undefined,
      },
    });
    method = 'name';
  }

  // §7.1 三信号融合：当前只有文本自指信号可用（无音频→无声纹；metadata 信号待 RSS/标题抽取）。
  // 用 fuseIdentitySignals 打分，落入不确定带（review）时仍写入但 confidence 低于 auto。
  const fused = fuseIdentitySignals({
    voiceCos: null, // 声纹需音频（P1 才有数据）
    metaMatch: false, // 元数据信号待接 RSS/标题
    textMatch: true, // 名字匹配即文本自指
  });
  const confidence = fused.band === 'auto' ? 0.95 : fused.score;

  await prisma.speakerIdentity.upsert({
    where: { participantId }, // §7.1: participantId 现为唯一（一人一集一 entity）
    create: {
      participantId,
      entityId: entity.id,
      confidence,
      method: fused.method,
      evidenceJson: { textQuote: participant.name, role: participant.role ?? null, band: fused.band, score: fused.score },
      signalsJson: {
        name: participant.name,
        role: participant.role ?? null,
        speakerLabel: participant.speakerLabel ?? null,
      },
    },
    update: {
      confidence,
      method: fused.method,
      evidenceJson: { textQuote: participant.name, role: participant.role ?? null, band: fused.band, score: fused.score },
      signalsJson: {
        name: participant.name,
        role: participant.role ?? null,
        speakerLabel: participant.speakerLabel ?? null,
      },
    },
  });

  // Mark the participant resolved (best-effort; keeps isResolved meaningful).
  await prisma.participant.update({
    where: { id: participantId },
    data: { isResolved: true },
  });

  return { participantId, entityId: entity.id, confidence, method };
}

/**
 * Resolve every named participant in a conversation. Returns a summary suitable
 * for logging / job metrics. Anonymous speakers are skipped (returned in `skippedAnonymous`).
 */
export async function resolveConversationIdentities(conversationId: string): Promise<{
  conversationId: string;
  linked: number;
  skippedAnonymous: number;
  entities: string[];
}> {
  const participants = await prisma.participant.findMany({
    where: { conversationId },
    select: { id: true, name: true },
  });
  let linked = 0;
  let skippedAnonymous = 0;
  const entities: string[] = [];
  for (const p of participants) {
    const r = await resolveParticipantIdentity(p.id);
    if (r) {
      linked++;
      entities.push(r.entityId);
    } else if (!isNamedSpeaker(p.name)) {
      skippedAnonymous++;
    }
  }
  logger.info('Conversation identities resolved', {
    conversationId,
    participants: participants.length,
    linked,
    skippedAnonymous,
  });
  return { conversationId, linked, skippedAnonymous, entities };
}
