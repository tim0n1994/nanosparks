/**
 * V2/T-V2-4: incremental conversation→graph merge.
 *
 * Replaces the corpus-level `delete + rebuild` in builder.ts (which scales
 * O(corpus) per import and blows up as episodes accumulate). On each completed
 * conversation we merge only THAT conversation's local subgraph into the corpus
 * graph: create nodes that don't yet exist, set-merge edges (idempotent on the
 * unique (source,target,relation)), and never delete. rebuildCorpusGraph is kept
 * as a monthly full-recalibration path.
 *
 * `buildLocalSubgraph` is pure + unit-tested so the merge semantics (who links
 * to whom, objection→claim contradicts) are pinned independently of the DB.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';

export interface PlannedNode {
  key: string;
  kind: string;
  label: string;
  canonicalText?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}
export interface PlannedEdge {
  fromKey: string;
  toKey: string;
  relation: string;
  confidence?: number;
}

export interface LocalSubgraph {
  nodes: PlannedNode[];
  edges: PlannedEdge[];
}

interface TuLike {
  id: string;
  type: string;
  text: string;
  participantId?: string | null;
  stance?: string | null;
}
interface ParticipantLike {
  id: string;
  name: string;
  speakerLabel?: string | null;
}
interface EntityMentionLike {
  surfaceForm: string;
  entity: { id: string; canonicalName: string; type: string };
}

const TU_KIND: Record<string, string> = {
  claim: 'claim_cluster',
  insight: 'claim_cluster',
  objection: 'claim_cluster',
  decision: 'decision',
  question: 'open_question',
  risk: 'open_question',
};

/**
 * Pure: plan the nodes + edges a conversation contributes to the corpus graph.
 * Deterministic keys make the merge idempotent — re-running on the same
 * conversation yields the same plan and the applier upserts instead of duping.
 */
export function buildLocalSubgraph(input: {
  thoughtUnits: TuLike[];
  participants: ParticipantLike[];
  entityMentions?: EntityMentionLike[];
}): LocalSubgraph {
  const nodes: PlannedNode[] = [];
  const edges: PlannedEdge[] = [];
  const pushNode = (n: PlannedNode) => {
    if (!nodes.some((x) => x.key === n.key)) nodes.push(n);
  };

  // Participant nodes
  for (const p of input.participants) {
    pushNode({ key: `participant:${p.id}`, kind: 'participant', label: p.name, canonicalText: p.name });
  }

  // TU nodes + authored_by edges
  const claimKeys: { key: string; tu: TuLike }[] = [];
  const sorted = [...input.thoughtUnits].sort((a, b) => 0); // preserve ingest order
  for (const tu of sorted) {
    const kind = TU_KIND[tu.type] ?? 'claim_cluster';
    const key = `tu:${tu.id}`;
    pushNode({
      key,
      kind,
      label: tu.text.slice(0, 80),
      canonicalText: tu.text,
      metadata: { type: tu.type, stance: tu.stance ?? null, thoughtUnitId: tu.id },
    });
    if (tu.participantId) {
      edges.push({ fromKey: key, toKey: `participant:${tu.participantId}`, relation: 'authored_by', confidence: 0.9 });
    }
    if (tu.type === 'claim' || tu.type === 'insight') claimKeys.push({ key, tu });
  }

  // Objection → nearest preceding claim (contradicts), same heuristic as builder step 6.
  for (const tu of input.thoughtUnits) {
    if (tu.type !== 'objection') continue;
    const last = claimKeys[claimKeys.length - 1];
    if (last) {
      edges.push({ fromKey: `tu:${tu.id}`, toKey: last.key, relation: 'contradicts', confidence: 0.8 });
    }
  }

  // Entity nodes + mentions edges + co-occurrence
  const entityKeys: string[] = [];
  for (const em of input.entityMentions ?? []) {
    const key = `entity:${em.entity.type}:${em.entity.canonicalName}`;
    pushNode({ key, kind: 'entity', label: em.entity.canonicalName, canonicalText: em.entity.canonicalName, entityId: em.entity.id });
    entityKeys.push(key);
    // link the most recent claim to the entity (discusses) — cheap topical anchor
    const last = claimKeys[claimKeys.length - 1];
    if (last) edges.push({ fromKey: last.key, toKey: key, relation: 'discusses', confidence: 0.6 });
  }
  // entity co-occurrence within this conversation
  for (let i = 0; i < entityKeys.length; i++) {
    for (let j = i + 1; j < entityKeys.length; j++) {
      edges.push({ fromKey: entityKeys[i], toKey: entityKeys[j], relation: 'co_occurs', confidence: 0.5 });
    }
  }

  return { nodes, edges };
}

/**
 * Apply a planned local subgraph to the corpus graph idempotently.
 * Nodes: matched by (corpusId, kind, canonicalText) → reuse, else create.
 * Edges: createEdge swallows the unique-constraint violation on re-runs.
 */
export async function mergeConversationIntoGraph(
  conversationId: string,
): Promise<{ nodesAdded: number; edgesAdded: number; nodesReused: number }> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      corpusId: true,
      status: true,
      thoughtUnits: { select: { id: true, type: true, text: true, participantId: true, stance: true } },
      participants: { select: { id: true, name: true, speakerLabel: true } },
      entityMentions: { select: { surfaceForm: true, entity: { select: { id: true, canonicalName: true, type: true } } } },
    },
  });
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  const corpusId = conversation.corpusId;

  const plan = buildLocalSubgraph({
    thoughtUnits: conversation.thoughtUnits,
    participants: conversation.participants,
    entityMentions: conversation.entityMentions,
  });

  // Resolve each planned node key → a GraphNode id (create if absent).
  const keyToNodeId = new Map<string, string>();
  // Seed with existing nodes that match by canonicalText (cheap reuse pass).
  const existingByCanonical = await prisma.graphNode.findMany({
    where: { corpusId, canonicalText: { in: plan.nodes.map((n) => n.canonicalText ?? n.label) } },
    select: { id: true, kind: true, canonicalText: true },
  });
  const existingIndex = new Map(existingByCanonical.map((n) => [`${n.kind}:${n.canonicalText}`, n.id]));

  let nodesAdded = 0;
  let nodesReused = 0;
  for (const node of plan.nodes) {
    const reuseKey = `${node.kind}:${node.canonicalText ?? node.label}`;
    const existing = existingIndex.get(reuseKey);
    if (existing) {
      keyToNodeId.set(node.key, existing);
      nodesReused++;
      continue;
    }
    const created = await prisma.graphNode.create({
      data: {
        corpusId,
        kind: node.kind,
        label: node.label,
        canonicalText: node.canonicalText ?? null,
        entityId: node.entityId ?? null,
        metadataJson: (node.metadata ?? null) as Prisma.InputJsonValue,
      },
    });
    keyToNodeId.set(node.key, created.id);
    existingIndex.set(reuseKey, created.id);
    nodesAdded++;
  }

  // Set-merge edges.
  let edgesAdded = 0;
  for (const edge of plan.edges) {
    const sourceNodeId = keyToNodeId.get(edge.fromKey);
    const targetNodeId = keyToNodeId.get(edge.toKey);
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;
    if (await createEdge(corpusId, sourceNodeId, targetNodeId, edge.relation, edge.confidence ?? 0.8)) {
      edgesAdded++;
    }
  }

  logger.info('Incremental graph merge', {
    conversationId,
    corpusId,
    nodesAdded,
    nodesReused,
    edgesAdded,
  });
  return { nodesAdded, edgesAdded, nodesReused };
}

/** Returns true if a new edge row was inserted (false if it already existed). */
async function createEdge(
  corpusId: string,
  sourceNodeId: string,
  targetNodeId: string,
  relation: string,
  confidence: number,
): Promise<boolean> {
  try {
    await prisma.graphEdge.create({
      data: { corpusId, sourceNodeId, targetNodeId, relation, confidence },
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false; // unique (source,target,relation) already present — set-merge no-op
    }
    throw error;
  }
}
