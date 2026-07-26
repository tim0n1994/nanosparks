/**
 * V3/T-V3-5: persona chat — person-scoped grounded RAG.
 *
 * Retrieves only the target participant's Turns/ThoughtUnits, generates with a
 * red-line system prompt that forbids extrapolation, and verifies every citation
 * via the existing citation-verifier. Returns refused=true (with a fixed
 * message) when retrieval is empty or the request crosses a red line.
 *
 * Boundary detection (isBoundaryRequest) is pure + unit-tested so the refusal
 * policy is explicit. The grounded generation reuses hybridSearch (with a
 * participant filter when wired) + citation-verifier — no new retrieval stack.
 */

import { generateEmbedding } from '@/lib/embeddings';
import { hybridSearch } from '@/lib/rag/hybrid-search';
import { verifyCitations, stripUnverifiedCitations, type Citation } from '@/lib/rag/citation-verifier';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { PERSONA_CHAT_SYSTEM, PERSONA_REFUSE_EMPTY } from '@/lib/llm/prompts/persona-chat';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface PersonaAnswerResult {
  answer: string;
  citations: Citation[];
  refused: boolean;
  reason?: string;
}

// Red-line substrings (lowercased) that must always be refused.
const BOUNDARY_PATTERNS = [
  '声音克隆', 'voice clone', 'clone the voice', 'deepfake',
  '视频头像', 'video avatar', 'digital human',
  '骂人', '侮辱', '辱骂', 'insult', 'attack', 'swear',
  '骂', '羞辱', '攻击',
  '冒充本人', '假装是本人', 'impersonate',
  'export as', '导出为本人', '当作本人',
];

/** Pure: detect requests that cross a persona-chat red line. Exported for tests. */
export function isBoundaryRequest(question: string): boolean {
  const q = (question ?? '').toLowerCase();
  return BOUNDARY_PATTERNS.some((p) => q.includes(p.toLowerCase()));
}

/**
 * Answer a question as a person, grounded only in that person's retrieved
 * turns. corpusId is the search boundary; participantId scopes retrieval to the
 * person (when available). Falls back to corpus-wide retrieval filtered by
 * entities if no participantId is resolvable.
 */
export async function personaAnswer(
  entityId: string,
  question: string,
  opts: { corpusId: string; participantId?: string | null; client?: OpenAIClient | ClaudeClient } = {
    corpusId: '',
  },
): Promise<PersonaAnswerResult> {
  // Red line 1: boundary request → refuse without any generation.
  if (isBoundaryRequest(question)) {
    return { answer: '抱歉，这个请求超出了我能做的范围。', citations: [], refused: true, reason: 'boundary' };
  }

  const { corpusId, participantId } = opts;
  if (!corpusId) {
    return { answer: '', citations: [], refused: true, reason: 'no_corpus' };
  }

  // Load the profile for style + few-shot + episode count.
  const profile = await prisma.personProfile.findUnique({
    where: { entityId },
    include: { entity: { select: { canonicalName: true } } },
  });
  if (!profile || !profile.chatEnabled) {
    return { answer: '该人物尚未开放对话（出场集数不足或属于敏感人物）。', citations: [], refused: true, reason: 'chat_disabled' };
  }
  const name = profile.entity.canonicalName;
  const episodeCount = Number((profile.statsJson as { conversationCount?: number } | null)?.conversationCount ?? 0);

  // Retrieve the person's turns only.
  let queryVector: number[] = [];
  try {
    queryVector = await generateEmbedding(question);
  } catch {
    /* FTS-only */
  }
  // Person-scoped retrieval: narrow the corpus-wide hybrid hits to only THIS
  // PERSON's OWN turns (via SpeakerIdentity, P0). Previously scoped by
  // EntityMention (conversations that mention them) — which returned turns
  // OTHER people said about them (PRD §0.1 / §9.2 fix). Now it's their speech.
  const rawHits = await hybridSearch(question, queryVector, { corpusId, topK: 30, limit: 12, graphExpansion: false });
  // The person's own ThoughtUnit ids (via SpeakerIdentity -> Participant ->
  // ThoughtUnit.participantId). hybridSearch returns ThoughtUnits keyed by id,
  // so we scope to TUs this person actually asserted (PRD §9.2 / §0.1 fix).
  const ownTuIds = new Set(
    (await prisma.thoughtUnit.findMany({
      where: { participant: { speakerIdentities: { some: { entityId } } } },
      select: { id: true },
    })).map((t) => t.id),
  );
  // Narrow to hits that ARE this person's own turns.
  const scoped = rawHits.filter((h) => ownTuIds.has(h.thoughtUnitId));
  void participantId;
  // If the person has no attributed turns yet, there's nothing grounded to say
  // → treat as empty retrieval (forces the honest refusal).
  if (ownTuIds.size === 0) {
    return { answer: PERSONA_REFUSE_EMPTY(episodeCount), citations: [], refused: true, reason: 'no_person_corpus' };
  }

  // Red line 2: empty retrieval → fixed refusal.
  if (scoped.length === 0) {
    return { answer: PERSONA_REFUSE_EMPTY(episodeCount), citations: [], refused: true, reason: 'empty_retrieval' };
  }

  // Build grounded context.
  const context = scoped
    .map((h, i) => `[${i + 1}] ${h.text}`)
    .join('\n');
  const style = JSON.stringify(profile.styleJson ?? {});
  const fewShot = scoped.slice(0, 3).map((h) => h.text).join('\n');

  const system = PERSONA_CHAT_SYSTEM
    .replace('{name}', name)
    .replace('{style}', style)
    .replace('{N}', String(episodeCount))
    .replace('{fewShot}', fewShot);

  const client = opts.client ?? (await makeDefaultClient());
  const userPrompt = `仅依据以下检索到的真实发言回答，每个事实陈述后用 [编号] 引用，禁止外推。\n\n检索片段：\n${context}\n\n问题：${question}`;

  const response = await client.completeWithRetry(
    [
      { role: 'user', content: `${system}\n\n${userPrompt}` },
    ],
    1024,
    3,
  );

  // Verify citations via the shared citation-verifier (same as Ask).
  const verified = verifyCitations(response.content, scoped);
  if (verified.verifiedCount === 0 && verified.citations.length > 0) {
    logger.warn('Persona answer had no verifiable citations; refusing', { entityId });
    return { answer: PERSONA_REFUSE_EMPTY(episodeCount), citations: [], refused: true, reason: 'no_verifiable_citation' };
  }
  // Strip unverified citation markers so the answer only references real sources.
  const answer = stripUnverifiedCitations(response.content, scoped);

  return {
    answer,
    citations: verified.citations.filter((c) => c.verified),
    refused: false,
  };
}

async function makeDefaultClient(): Promise<OpenAIClient | ClaudeClient> {
  const settings = await getLlmSettings();
  if (settings.apiFormat === 'anthropic') {
    return new ClaudeClient(settings.apiKey, settings.model, settings.baseUrl);
  }
  return new OpenAIClient(settings.apiKey, settings.model, settings.baseUrl);
}
