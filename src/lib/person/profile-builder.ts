/**
 * V3/T-V2-2/T-V3-2: PersonProfile aggregation.
 *
 * For a person Entity, incrementally recompute the aggregated profile: stats
 * (mention count / episode count / speaking time / first-last seen), style card
 * (LLM-summarized from a sample of their turns), relations (co-appears /
 * supports / contradicts), and a cached human-readable summary.
 *
 * chatEnabled is the hard gate: only persons with >= MIN_EPISODES_FOR_CHAT
 * distinct conversations get chatEnabled=true (P-2 persona chat requirement).
 * The pure threshold helper is exported + unit-tested so the gate policy is
 * explicit and not buried in the builder.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { PERSONA_STYLE_PROMPT } from '@/lib/llm/prompts/persona-style';
import { z } from 'zod';

export const MIN_EPISODES_FOR_CHAT = 3;

/**
 * Pure: decide whether a person qualifies for persona chat given their distinct
 * conversation count. Separated so the threshold is testable and adjustable.
 */
export function qualifiesForChat(
  conversationCount: number,
  opts: { sensitive?: boolean; minEpisodes?: number } = {},
): boolean {
  if (opts.sensitive) return false;
  const threshold = opts.minEpisodes ?? MIN_EPISODES_FOR_CHAT;
  return conversationCount >= threshold;
}

const styleSchema = z.object({
  catchphrases: z.array(z.string()).default([]),
  metaphors: z.array(z.string()).default([]),
  sentencePatterns: z.array(z.string()).default([]),
  toneSummary: z.string().default(''),
});

/**
 * DB-backed: (re)build the PersonProfile for a person Entity. Idempotent —
 * upserts on entityId. Best-effort: style/summary LLM steps degrade gracefully
 * (leave null) if the model call fails.
 */
export async function buildPersonProfile(
  entityId: string,
  opts: { client?: OpenAIClient; sensitive?: boolean } = {},
): Promise<{ entityId: string; chatEnabled: boolean; created: boolean }> {
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { id: true, canonicalName: true, type: true, workspaceId: true },
  });
  if (!entity || entity.type !== 'person') {
    throw new Error(`Entity ${entityId} is not a person (or not found)`);
  }

  // ── Stats + style sample from SPOKEN turns (this person's own speech) ──
  // PRD §1.2: counting EntityMention measures "how many episodes mention them",
  // not "how many episodes they spoke in". SpeakerIdentity (Participant↔Entity)
  // gives the real spoken set. Falls back to mentions when no identity link
  // exists yet (pre-P0 conversations).
  const { spokenConversationIds, mentionCount, spokenTurnCount } = await computeSpokenStats(entityId);

  // Stats also keep mention-derived first/last seen (mentions may predate the
  // first linked spoken turn), so the timeline is the union.
  const mentions = await prisma.entityMention.findMany({
    where: { entityId },
    select: { conversationId: true, createdAt: true },
  });
  const mentionConvIds = [...new Set(mentions.map((m) => m.conversationId))];
  const statConversationIds = new Set<string>([...spokenConversationIds, ...mentionConvIds]);
  const convRows = await prisma.conversation.findMany({
    where: { id: { in: [...statConversationIds] } },
    select: { id: true, createdAt: true },
  });
  const createdAts = convRows.map((c) => c.createdAt.getTime()).sort((a, b) => a - b);
  const stats = {
    mentionCount: mentions.length,
    conversationCount: statConversationIds.size,
    spokenConversationCount: spokenConversationIds.length,
    spokenTurnCount,
    firstSeenAt: createdAts.length ? new Date(createdAts[0]).toISOString() : null,
    lastSeenAt: createdAts.length ? new Date(createdAts[createdAts.length - 1]).toISOString() : null,
  };

  // ── Style card (LLM) — sample up to 12 of THIS PERSON's own spoken turns ──
  let styleJson: Record<string, unknown> | null = null;
  let summaryText: string | null = null;
  try {
    const client = opts.client ?? (await makeDefaultClient());
    // Now driven by SpeakerIdentity: turns whose participant is linked to this
    // entity. This is the fix for PRD §0.1 ("蒸馏对象错人") — previously we
    // sampled turns whose text CONTAINED the name, i.e. mostly the host naming
    // the guest. Falls back to the name-ILIKE heuristic only when no linked turns.
    const ownTurns = await prisma.turn.findMany({
      where: {
        participant: { speakerIdentities: { some: { entityId } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { text: true },
    });
    const sampleTurns = ownTurns.length > 0
      ? ownTurns
      : await prisma.$queryRawUnsafe<Array<{ text: string }>>(
          `SELECT t.text FROM "Turn" t WHERE t.text ILIKE '%' || $1 || '%' ORDER BY t."createdAt" DESC LIMIT 12`,
          entity.canonicalName,
        );
    if (sampleTurns.length > 0) {
      const sample = sampleTurns.map((t) => t.text.slice(0, 300)).join('\n---\n');
      const parsed = await client.completeStructured(
        [{ role: 'user', content: PERSONA_STYLE_PROMPT.replace('{{turns}}', sample) }],
        styleSchema,
        { maxTokens: 1024, schemaName: 'persona_style' },
      );
      styleJson = parsed as unknown as Record<string, unknown>;
      summaryText = `${entity.canonicalName}：${parsed.toneSummary || '风格待补充'}。说了 ${spokenConversationIds.length} 集。`;
    }
  } catch (e) {
    logger.warn('Persona style summary failed', { entityId, error: String(e) });
  }

  // ── Relations: co-appears with other entities in the same conversations ──
  const relations = await computeRelations(entityId, [...statConversationIds]);

  // chatEnabled gate now counts SPOKEN episodes (not mentions). PRD §9.2: the
  // threshold form is right; it was measuring the wrong quantity.
  const chatEnabled = qualifiesForChat(spokenConversationIds.length, { sensitive: opts.sensitive });

  // Upsert profile.
  const existing = await prisma.personProfile.findUnique({ where: { entityId } });
  const data = {
    displayName: entity.canonicalName,
    statsJson: toPrismaJson(stats) as never,
    styleJson: (styleJson ?? null) as never,
    relationsJson: toPrismaJson(relations) as never,
    summaryText,
    chatEnabled,
  };
  if (existing) {
    await prisma.personProfile.update({ where: { entityId }, data });
  } else {
    await prisma.personProfile.create({ data: { entityId, ...data } });
  }

  logger.info('PersonProfile built', {
    entityId,
    name: entity.canonicalName,
    spokenConversations: spokenConversationIds.length,
    statConversations: statConversationIds.size,
    spokenTurns: spokenTurnCount,
    chatEnabled,
  });
  return { entityId, chatEnabled, created: !existing };
}

/**
 * Compute spoken stats for a person Entity: distinct conversations where one of
 * their linked Participants actually has turns, and the total turn count.
 * Pure DB aggregation over SpeakerIdentity (L0). Returns empty sets when the
 * person has no identity links yet (pre-P0 data) so callers fall back.
 */
async function computeSpokenStats(
  entityId: string,
): Promise<{ spokenConversationIds: string[]; mentionCount: number; spokenTurnCount: number }> {
  const participants = await prisma.participant.findMany({
    where: { speakerIdentities: { some: { entityId } } },
    select: {
      conversationId: true,
      _count: { select: { turns: true } },
    },
  });
  const spokenConversationIds = [...new Set(participants.map((p) => p.conversationId))];
  const spokenTurnCount = participants.reduce((n, p) => n + p._count.turns, 0);
  return { spokenConversationIds, mentionCount: 0, spokenTurnCount };
}

async function computeRelations(entityId: string, conversationIds: string[]): Promise<Record<string, unknown>> {
  if (conversationIds.length === 0) return { coAppears: [] };
  const coMentions = await prisma.entityMention.findMany({
    where: { conversationId: { in: conversationIds }, entityId: { not: entityId } },
    select: { entityId: true, entity: { select: { canonicalName: true, type: true } } },
  });
  const counts = new Map<string, { name: string; count: number }>();
  for (const m of coMentions) {
    const cur = counts.get(m.entityId);
    if (cur) cur.count++;
    else counts.set(m.entityId, { name: m.entity.canonicalName, count: 1 });
  }
  const coAppears = [...counts.entries()]
    .map(([id, v]) => ({ entityId: id, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  return { coAppears };
}

async function makeDefaultClient(): Promise<OpenAIClient | ClaudeClient> {
  const settings = await getLlmSettings();
  if (settings.apiFormat === 'anthropic') {
    return new ClaudeClient(settings.apiKey, settings.model, settings.baseUrl);
  }
  return new OpenAIClient(settings.apiKey, settings.model, settings.baseUrl);
}
