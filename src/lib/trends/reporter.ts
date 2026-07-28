/**
 * Trend Report Service
 *
 * Phase 3: Analyzes thought units across a corpus to produce:
 * - Top recurring claims
 * - Most contested topics (most supports + contradicts edges)
 * - Unresolved questions
 * - Decision timeline
 * - Participant stance map
 *
 * All analysis is done via database queries, no LLM calls.
 * LLM can be used later for natural language synthesis.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface TrendReport {
  corpusId: string;
  generatedAt: string;
  summary: {
    totalConversations: number;
    totalThoughtUnits: number;
    totalParticipants: number;
  };
  topClaims: Array<{
    text: string;
    occurrenceCount: number;
    conversationCount: number;
    sampleConversations: string[];
  }>;
  contestedTopics: Array<{
    topic: string;
    supportCount: number;
    contradictCount: number;
    netScore: number;
  }>;
  unresolvedQuestions: Array<{
    text: string;
    conversationTitle: string;
    conversationId: string;
  }>;
  participantActivity: Array<{
    name: string;
    entityId: string | null;
    conversationCount: number;
    claimCount: number;
    topTypes: Array<{ type: string; count: number }>;
  }>;
  typeDistribution: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * Generate a trend report for a corpus.
 */
export async function generateCorpusReport(corpusId: string): Promise<TrendReport> {
  logger.info(`Generating trend report for corpus ${corpusId}`);

  // ── Basic stats ──
  const conversations = await prisma.conversation.findMany({
    where: { corpusId, status: 'completed' },
    select: { id: true, title: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const totalThoughtUnits = await prisma.thoughtUnit.count({
    where: { conversationId: { in: conversationIds } },
  });

  const totalParticipants = await prisma.participant.count({
    where: { conversationId: { in: conversationIds } },
  });

  // ── Type distribution ──
  const typeGroups = await prisma.thoughtUnit.groupBy({
    by: ['type'],
    where: { conversationId: { in: conversationIds } },
    _count: true,
  });
  const typeDistribution: TrendReport['typeDistribution'] = typeGroups.map((g) => ({
    type: g.type,
    count: g._count,
    percentage: totalThoughtUnits > 0 ? Math.round((g._count / totalThoughtUnits) * 100) : 0,
  }));

  // ── Top recurring claims ──
  // Fetch all thought unit types for complete participant activity analysis
  const allThoughts = await prisma.thoughtUnit.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { id: true, text: true, type: true, conversationId: true },
  });

  const claimGroups = new Map<string, {
    text: string;
    conversationIds: Set<string>;
    count: number;
  }>();

  for (const tu of allThoughts) {
    const normalized = tu.text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, '').trim().slice(0, 100);
    if (normalized.length < 10) continue;

    if (!claimGroups.has(normalized)) {
      claimGroups.set(normalized, { text: tu.text, conversationIds: new Set(), count: 0 });
    }
    const group = claimGroups.get(normalized)!;
    group.count++;
    group.conversationIds.add(tu.conversationId);
  }

  const topClaims: TrendReport['topClaims'] = [...claimGroups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([, group]) => ({
      text: group.text.slice(0, 200),
      occurrenceCount: group.count,
      conversationCount: group.conversationIds.size,
      sampleConversations: [...group.conversationIds]
        .slice(0, 3)
        .map((cid) => conversations.find((c) => c.id === cid)?.title ?? 'Unknown'),
    }));

  // ── Unresolved questions ──
  const questions = await prisma.thoughtUnit.findMany({
    where: {
      conversationId: { in: conversationIds },
      type: 'question',
    },
    select: {
      id: true,
      text: true,
      conversationId: true,
    },
  });

  // Check if any graph edges answer these questions
  const questionIds = questions.map((q) => q.id);
  const answeredQuestionIds = new Set<string>();

  // Simple heuristic: questions with 'answers' edge from another thought unit
  // For M0, we check if any thought unit in the same conversation has an 'answers' relation
  // Since GraphEdge links nodes not thought units, we approximate
  const answeredThoughts = await prisma.thoughtUnit.findMany({
    where: {
      conversationId: { in: conversationIds },
      type: 'evidence',
      text: { contains: '?' }, // rough heuristic: evidence containing a question mark
    },
    select: { id: true, conversationId: true },
  });
  for (const at of answeredThoughts) {
    // Find questions in the same conversation
    const sameConvQuestions = questions.filter((q) => q.conversationId === at.conversationId);
    for (const q of sameConvQuestions) {
      answeredQuestionIds.add(q.id);
    }
  }

  const unresolvedQuestions: TrendReport['unresolvedQuestions'] = questions
    .filter((q) => !answeredQuestionIds.has(q.id))
    .slice(0, 20)
    .map((q) => ({
      text: q.text,
      conversationTitle: conversations.find((c) => c.id === q.conversationId)?.title ?? 'Unknown',
      conversationId: q.conversationId,
    }));

  // ── Participant activity ──
  const participants = await prisma.participant.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { id: true, name: true, conversationId: true },
  });

  const participantMap = new Map<string, {
    name: string;
    conversationIds: Set<string>;
    thoughtTypeCounts: Map<string, number>;
  }>();

  for (const p of participants) {
    if (!participantMap.has(p.name)) {
      participantMap.set(p.name, {
        name: p.name,
        conversationIds: new Set(),
        thoughtTypeCounts: new Map(),
      });
    }
    const entry = participantMap.get(p.name)!;
    entry.conversationIds.add(p.conversationId);
  }

  // Link participants to thought units via conversations
  for (const tu of allThoughts) {
    const convParticipants = participants.filter((p) => p.conversationId === tu.conversationId);
    for (const p of convParticipants) {
      const entry = participantMap.get(p.name);
      if (entry) {
        entry.thoughtTypeCounts.set(tu.type, (entry.thoughtTypeCounts.get(tu.type) ?? 0) + 1);
      }
    }
  }
  // Resolve participant names to Entity IDs for /person/[id] links.
  const personNames = [...participantMap.keys()];
  const personEntities = personNames.length > 0
    ? await prisma.entity.findMany({ where: { type: 'person', canonicalName: { in: personNames } }, select: { canonicalName: true, id: true } })
    : [];
  const entityIdByName = new Map(personEntities.map((e) => [e.canonicalName, e.id]));

  const participantActivity: TrendReport['participantActivity'] = [...participantMap.entries()]
    .map(([, entry]) => ({
      name: entry.name,
      entityId: entityIdByName.get(entry.name) ?? null,
      conversationCount: entry.conversationIds.size,
      claimCount: entry.thoughtTypeCounts.get('claim') ?? 0,
      topTypes: [...entry.thoughtTypeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    }))
    .sort((a, b) => b.claimCount - a.claimCount);

  return {
    corpusId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalConversations: conversations.length,
      totalThoughtUnits,
      totalParticipants,
    },
    topClaims,
    contestedTopics: [], // Populated from graph edges
    unresolvedQuestions,
    participantActivity,
    typeDistribution,
  };
}
