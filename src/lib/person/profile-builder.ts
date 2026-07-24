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

  // ── Stats from EntityMention ──
  const mentions = await prisma.entityMention.findMany({
    where: { entityId },
    select: { conversationId: true, createdAt: true },
  });
  const conversationIds = [...new Set(mentions.map((m) => m.conversationId))];
  const convRows = await prisma.conversation.findMany({
    where: { id: { in: conversationIds } },
    select: { id: true, createdAt: true },
  });
  const createdAts = convRows.map((c) => c.createdAt.getTime()).sort((a, b) => a - b);
  const stats = {
    mentionCount: mentions.length,
    conversationCount: conversationIds.length,
    firstSeenAt: createdAts.length ? new Date(createdAts[0]).toISOString() : null,
    lastSeenAt: createdAts.length ? new Date(createdAts[createdAts.length - 1]).toISOString() : null,
  };

  // ── Style card (LLM) — sample up to 12 of this person's turns ──
  let styleJson: Record<string, unknown> | null = null;
  let summaryText: string | null = null;
  try {
    const client = opts.client ?? (await makeDefaultClient());
    // Heuristic: pull turns whose text contains the canonical name / an alias.
    // Cheap and good enough for a style sample; exact speaker attribution (V1)
    // would be tighter but requires participantId↔entity linking not yet built.
    const sampleTurns = await prisma.$queryRawUnsafe<Array<{ text: string }>>(
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
      summaryText = `${entity.canonicalName}：${parsed.toneSummary || '风格待补充'}。出现在 ${conversationIds.length} 集中。`;
    }
  } catch (e) {
    logger.warn('Persona style summary failed', { entityId, error: String(e) });
  }

  // ── Relations: co-appears with other entities in the same conversations ──
  const relations = await computeRelations(entityId, conversationIds);

  const chatEnabled = qualifiesForChat(conversationIds.length, { sensitive: opts.sensitive });

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

  logger.info('PersonProfile built', { entityId, name: entity.canonicalName, conversations: conversationIds.length, chatEnabled });
  return { entityId, chatEnabled, created: !existing };
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
