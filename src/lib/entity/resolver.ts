/**
 * V2/T-V2-3: Three-level entity resolution funnel.
 *
 * Given candidate entities (surfaceForm + type + canonicalGuess) emitted by the
 * windowed extraction pass, decide for each whether it maps to an existing
 * Entity row in the workspace or needs a new one. Three tiers, cheapest first:
 *
 *   L1 exact  — normalized canonicalName / alias hit (pure DB, no model call)
 *   L2 embed  — pgvector nearest-neighbour of the canonicalGuess embedding
 *               among same-type entities in the workspace (cosine ≥ threshold)
 *   L3 llm    — batch arbitration: for the still-unresolved candidates, ask a
 *               cheap model whether each is "the same as" any top-K existing
 *               entity of the same type.
 *
 * The pure normalization/matching helpers are exported + unit-tested so the
 * resolution semantics are pinned independently of the DB/LLM/infra.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { generateEmbedding } from '@/lib/embeddings';
import { vectorSearch, storeEmbedding } from '@/lib/embeddings/search';
import type { OpenAIClient } from '@/lib/llm/client';
import { ENTITY_RESOLUTION_PROMPT } from '@/lib/llm/prompts/entity-resolution';
import { z } from 'zod';

export interface EntityCandidate {
  surfaceForm: string;
  type: string;
  canonicalGuess: string;
}

export type ResolveMethod = 'exact' | 'embedding' | 'llm' | 'new';

export interface ResolveResult {
  entityId: string;
  created: boolean;
  method: ResolveMethod;
}

export const ENTITY_TYPES = ['person', 'org', 'product', 'book', 'concept', 'event'] as const;

/** Normalize a name for exact/alias comparison: lowercase, strip punctuation/ws. */
export function normalizeEntityName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

/** Canonicalize the free-form model `type` to the known set (else 'concept'). */
export function normalizeEntityType(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase().trim();
  if ((ENTITY_TYPES as readonly string[]).includes(t)) return t;
  if (t.includes('person') || t.includes('people') || t.includes('human') || t.includes('人物')) return 'person';
  if (t.includes('org') || t.includes('company') || t.includes('机构') || t.includes('公司')) return 'org';
  if (t.includes('product') || t.includes('tool') || t.includes('产品') || t.includes('工具')) return 'product';
  if (t.includes('book') || t.includes('work') || t.includes('书') || t.includes('作品')) return 'book';
  if (t.includes('event') || t.includes('事件')) return 'event';
  return 'concept';
}

/** True if the candidate's normalized name matches an existing entity name/alias. */
export function matchesExisting(
  cand: EntityCandidate,
  existing: { canonicalName: string; aliasesJson: unknown },
): boolean {
  const key = normalizeEntityName(cand.canonicalGuess);
  if (!key) return false;
  if (normalizeEntityName(existing.canonicalName) === key) return true;
  const aliases = Array.isArray(existing.aliasesJson) ? (existing.aliasesJson as unknown[]) : [];
  return aliases.some((a) => normalizeEntityName(String(a)) === key);
}

const EMBEDDING_THRESHOLD = 0.86; // cosine similarity for "same entity"

/**
 * Resolve a single candidate. Creates a new Entity when no tier matches.
 * L2/L3 are skipped gracefully if no embedding provider / no client is given,
 * so the resolver degrades to exact-match + create-new without throwing.
 */
export async function resolveEntity(
  workspaceId: string,
  cand: EntityCandidate,
  opts: { client?: OpenAIClient; useEmbeddings?: boolean } = {},
): Promise<ResolveResult> {
  const type = normalizeEntityType(cand.type);
  const nameKey = normalizeEntityName(cand.canonicalGuess);

  // L1: exact name/alias
  const existing = await prisma.entity.findMany({
    where: { workspaceId, type },
    select: { id: true, canonicalName: true, aliasesJson: true },
  });
  const exact = existing.find((e) => matchesExisting({ ...cand, type }, e));
  if (exact) {
    await mergeAlias(exact.id, cand.surfaceForm, exact.aliasesJson);
    return { entityId: exact.id, created: false, method: 'exact' };
  }

  // L2: embedding nearest-neighbour (best-effort; skip if disabled/unavailable)
  if (opts.useEmbeddings !== false && nameKey) {
    const embHit = await resolveByEmbedding(workspaceId, type, cand.canonicalGuess, existing);
    if (embHit) {
      await mergeAlias(embHit.entityId, cand.surfaceForm, null);
      return { entityId: embHit.entityId, created: false, method: 'embedding' };
    }
  }

  // L3: LLM arbitration (best-effort)
  if (opts.client && existing.length > 0) {
    const llmHit = await resolveByLlm(opts.client, cand, type, existing.slice(0, 10));
    if (llmHit) {
      await mergeAlias(llmHit, cand.surfaceForm, null);
      return { entityId: llmHit, created: false, method: 'llm' };
    }
  }

  // No match → create new Entity, persist its embedding for future L2 hits.
  const created = await prisma.entity.create({
    data: {
      workspaceId,
      type,
      canonicalName: cand.canonicalGuess.trim() || cand.surfaceForm,
      aliasesJson: cand.surfaceForm.trim() && cand.surfaceForm !== cand.canonicalGuess ? [cand.surfaceForm.trim()] : [],
    },
  });
 if (opts.useEmbeddings !== false) {
   try {
     const vec = await generateEmbedding(created.canonicalName);
      await storeEmbedding(
        'entity',
        created.id,
        vec,
        process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      );
     await prisma.entity.update({ where: { id: created.id }, data: { embeddingId: created.id } });
    } catch (e) {
      logger.warn('Entity embedding persist failed', { entityId: created.id, error: String(e) });
    }
  }
  return { entityId: created.id, created: true, method: 'new' };
}

/**
 * Resolve a batch of candidates and return surfaceForm → entityId.
 * Dedups candidates by (type + normalized canonicalGuess) first so the same
 * mention never creates two entities.
 */
export async function resolveBatch(
  workspaceId: string,
  cands: EntityCandidate[],
  opts: { client?: OpenAIClient; useEmbeddings?: boolean } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seenKey = new Map<string, string>(); // normalized key → entityId

  for (const cand of cands) {
    const type = normalizeEntityType(cand.type);
    const key = `${type}:${normalizeEntityName(cand.canonicalGuess)}`;
    if (seenKey.has(key)) {
      out.set(cand.surfaceForm, seenKey.get(key)!);
      continue;
    }
    try {
      const res = await resolveEntity(workspaceId, cand, opts);
      seenKey.set(key, res.entityId);
      out.set(cand.surfaceForm, res.entityId);
    } catch (e) {
      logger.warn('Entity resolve failed', { cand: cand.canonicalGuess, error: String(e) });
    }
  }
  return out;
}

async function mergeAlias(entityId: string, surfaceForm: string, known: unknown): Promise<void> {
  const sf = (surfaceForm ?? '').trim();
  if (!sf) return;
  const aliases: string[] = Array.isArray(known) ? (known as unknown[]).map((a) => String(a)) : [];
  if (aliases.includes(sf)) return;
  try {
    await prisma.entity.update({
      where: { id: entityId },
      data: { aliasesJson: [...aliases, sf] as string[] },
    });
  } catch {
    /* non-fatal */
  }
}

async function resolveByEmbedding(
  workspaceId: string,
  type: string,
  canonicalGuess: string,
  existing: Array<{ id: string; canonicalName: string }>,
): Promise<{ entityId: string } | null> {
  try {
    const vec = await generateEmbedding(canonicalGuess);
    const hits = await vectorSearch(vec, { resourceType: 'entity', minSimilarity: EMBEDDING_THRESHOLD, limit: 10 });
    const ids = new Set(existing.map((e) => e.id));
    for (const h of hits) {
      if (ids.has(h.resourceId)) return { entityId: h.resourceId };
    }
    void workspaceId; // workspace scoping enforced via `existing` membership above
    return null;
  } catch {
    return null;
  }
}

const resolutionSchema = z.object({
  pairs: z
    .array(z.object({ candIdx: z.number(), matchedEntityId: z.string().nullable() }))
    .default([]),
});

async function resolveByLlm(
  client: OpenAIClient,
  cand: EntityCandidate,
  type: string,
  existing: Array<{ id: string; canonicalName: string }>,
): Promise<string | null> {
  try {
    const prompt = ENTITY_RESOLUTION_PROMPT.replace('{{type}}', type)
      .replace('{{candidate}}', `${cand.canonicalGuess} (also seen as: ${cand.surfaceForm})`)
      .replace('{{existing}}', JSON.stringify(existing.map((e) => ({ id: e.id, name: e.canonicalName }))));
    const result = await client.completeStructured(
      [{ role: 'user', content: prompt }],
      resolutionSchema,
      { maxTokens: 512, schemaName: 'entity_resolution' },
    );
   const hit = result.pairs.find((p) => p.candIdx === 0 && p.matchedEntityId);
   return hit?.matchedEntityId ?? null;
 } catch {
   return null;
 }
}

/**
 * V2/T-V2-2: persist a conversation's window-extracted entities.
 *
 * Resolves each candidate (creating Entity rows as needed via resolveBatch),
 * then writes one EntityMention per candidate surface form for this conversation.
 * Idempotent within a re-run: previous mentions for the conversation are cleared
 * first so re-extraction doesn't double-count. Best-effort — never throws into
 * the pipeline (failures are logged, entities are a value-add, not a gate).
 */
export async function persistConversationEntities(
  workspaceId: string,
  conversationId: string,
  candidates: EntityCandidate[],
  opts: { client?: OpenAIClient; useEmbeddings?: boolean } = {},
): Promise<{ entities: number; mentions: number }> {
  if (candidates.length === 0) return { entities: 0, mentions: 0 };
  try {
    const resolved = await resolveBatch(workspaceId, candidates, opts);
    await prisma.entityMention.deleteMany({ where: { conversationId } });
    let mentions = 0;
    for (const [surfaceForm, entityId] of resolved) {
      await prisma.entityMention.create({
        data: { entityId, conversationId, surfaceForm: surfaceForm.slice(0, 200) },
      });
      mentions++;
    }
    logger.info('Persisted conversation entities', { conversationId, entities: resolved.size, mentions });
    return { entities: resolved.size, mentions };
  } catch (error) {
    logger.warn('Entity persistence failed', { conversationId, error: String(error) });
    return { entities: 0, mentions: 0 };
  }
}
