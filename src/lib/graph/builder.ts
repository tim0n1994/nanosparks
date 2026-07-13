/**
 * Insight Graph Builder
 *
 * Builds knowledge graph from LLM analysis results (arguments, topics, speakers).
 * Nodes = claim, topic, participant. Edges = argument parent relations + topic associations.
 * Idempotent: deletes and rebuilds per corpus on each run.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function rebuildCorpusGraph(corpusId: string): Promise<{ nodesCreated: number; edgesCreated: number }> {
  logger.info(`Rebuilding graph for corpus ${corpusId}`);

  await prisma.graphEdge.deleteMany({ where: { corpusId } });
  await prisma.graphNode.deleteMany({ where: { corpusId } });

  const conversations = await prisma.conversation.findMany({
    where: { corpusId, status: 'completed' },
    include: {
      thoughtUnits: true,
      participants: true,
      source: { select: { episodeId: true } },
    },
  });

  if (conversations.length === 0) {
    logger.info(`No completed conversations for corpus ${corpusId}`);
    return { nodesCreated: 0, edgesCreated: 0 };
  }

  // ── Gather episode-level analysis data ──
  const episodeIds = conversations.map((c) => c.source?.episodeId).filter(Boolean) as string[];
  const analyses = await prisma.analysis.findMany({
    where: { episodeId: { in: episodeIds } },
    select: { episodeId: true, arguments: true, topics: true, speakers: true },
  });
  const analysisByEpisode = new Map(analyses.map((a) => [a.episodeId, a]));

  // ── Step 1: Create participant nodes ──
  const participantNodeIds = new Map<string, string>();
  for (const conv of conversations) {
    for (const p of conv.participants) {
      if (participantNodeIds.has(p.name)) continue;
      const node = await prisma.graphNode.create({
        data: {
          corpusId,
          kind: 'participant',
          label: p.name,
          canonicalText: p.name,
          metadataJson: { role: p.role, speakerLabel: p.speakerLabel },
        },
      });
      participantNodeIds.set(p.name, node.id);
    }
  }

  // ── Step 2: Create topic nodes from analysis ──
  const topicNodeIds = new Map<string, string>();
  for (const analysis of analyses) {
    for (const topic of (analysis.topics as Array<{ id: string; name: string; mentionCount: number; sentiment: string }>)) {
      if (topicNodeIds.has(topic.id)) continue;
      const node = await prisma.graphNode.create({
        data: {
          corpusId,
          kind: 'topic',
          label: topic.name,
          canonicalText: topic.name,
          metadataJson: { mentionCount: topic.mentionCount, sentiment: topic.sentiment },
        },
      });
      topicNodeIds.set(topic.id, node.id);
    }
  }

  // ── Step 3: Create claim nodes from arguments ──
  const argNodeIds = new Map<string, string>(); // argument.id → graphNode.id
  const argSpeakerIds = new Map<string, string>(); // argument.id → speaker.name
  for (const analysis of analyses) {
    const args = analysis.arguments as Array<{
      id: string; text: string; speakerId: string; type: string; parentId?: string | null; timestamp: number;
    }>;
    const speakers = analysis.speakers as Array<{ id: string; name: string; role: string }>;

    for (const arg of args) {
      const speakerName = speakers.find((s) => s.id === arg.speakerId)?.name || arg.speakerId;
      argSpeakerIds.set(arg.id, speakerName);

      const node = await prisma.graphNode.create({
        data: {
          corpusId,
          kind: 'claim_cluster',
          label: arg.text.slice(0, 80),
          canonicalText: arg.text,
          metadataJson: {
            type: arg.type,
            speakerId: arg.speakerId,
            speakerName,
            timestamp: arg.timestamp,
            sourceEpisodeId: analysis.episodeId,
          },
        },
      });
      argNodeIds.set(arg.id, node.id);

      // Link to participant
      const participantNodeId = participantNodeIds.get(speakerName);
      if (participantNodeId) {
        await createEdge(corpusId, node.id, participantNodeId, 'authored_by');
      }
    }
  }

  // ── Step 4: Create edges from argument parent relations ──
  // parentId means "this argument responds to parent"
  for (const analysis of analyses) {
    const args = analysis.arguments as Array<{ id: string; type: string; parentId?: string | null }>;
    for (const arg of args) {
      if (!arg.parentId) continue;
      const childNode = argNodeIds.get(arg.id);
      const parentNode = argNodeIds.get(arg.parentId);
      if (!childNode || !parentNode) continue;

      const relation = arg.type === 'support' ? 'supports'
        : arg.type === 'oppose' ? 'contradicts'
        : arg.type === 'refine' ? 'refines'
        : 'relates_to';

      await createEdge(corpusId, childNode, parentNode, relation);
    }
  }

  // ── Step 5: Link claim nodes to relevant topic nodes ──
  // Use LLM's own topic timestamps: if a claim's timestamp falls within a topic's timestamp range, link them
  for (const analysis of analyses) {
    const args = analysis.arguments as Array<{ id: string; timestamp: number }>;
    const topics = analysis.topics as Array<{ id: string; timestamps: number[]; name: string }>;

    for (const arg of args) {
      for (const topic of topics) {
        const nearTimestamp = topic.timestamps.some((ts) => Math.abs(ts - arg.timestamp) < 60);
        if (nearTimestamp) {
          const argNode = argNodeIds.get(arg.id);
          const topicNode = topicNodeIds.get(topic.id);
          if (argNode && topicNode) {
            await createEdge(corpusId, argNode, topicNode, 'discusses');
          }
        }
      }
    }
  }

  const nodesCreated = await prisma.graphNode.count({ where: { corpusId } });
  const edgesCreated = await prisma.graphEdge.count({ where: { corpusId } });

  logger.info(`Graph rebuilt for corpus ${corpusId}: ${nodesCreated} nodes, ${edgesCreated} edges`);
  return { nodesCreated, edgesCreated };
}

async function createEdge(
  corpusId: string,
  sourceNodeId: string,
  targetNodeId: string,
  relation: string,
): Promise<void> {
  if (sourceNodeId === targetNodeId) return;
  try {
    await prisma.graphEdge.create({
      data: { corpusId, sourceNodeId, targetNodeId, relation, confidence: 0.8 },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return;
    }
    throw error;
  }
}
