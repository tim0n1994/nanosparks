/**
 * Backfill script: re-run speaker attribution for conversations whose turns
 * have null participantId. This exists because all historical content was
 * analyzed before the speaker-attribution code (commit 6e30f4a) landed, so
 * 6031 turns had no speaker binding.
 *
 * Approach: re-enqueue the analyze job for affected conversations. The worker's
 * processConversationAnalysis → assignTurnSpeakers → syncConversationFromAnalysis
 * path rebuilds participants and re-links turns (sync deletes+recreates
 * participants, so it's idempotent).
 *
 * Usage:
 *   npx tsx scripts/backfill-turn-speakers.ts              # all conversations
 *   npx tsx scripts/backfill-turn-speakers.ts <convId>     # one conversation
 *
 * Requires: a running worker (npm run worker) + Redis + DB.
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { prisma } from '@/lib/prisma';
import { analyzeQueue } from '@/lib/queue/config';

async function main() {
  const targetId = process.argv[2];

  // Find conversations that have turns but turns lack participantId binding.
  const conversations = await prisma.conversation.findMany({
    where: {
      ...(targetId ? { id: targetId } : {}),
      status: 'completed',
      turns: { some: { participantId: null } },
    },
    select: { id: true, title: true, _count: { select: { turns: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (conversations.length === 0) {
    console.log(JSON.stringify({ msg: 'No conversations need backfill', ts: new Date().toISOString() }));
    await prisma.$disconnect();
    return;
  }

  console.log(JSON.stringify({
    msg: 'Backfill: enqueuing analyze jobs for speaker attribution',
    count: conversations.length,
    ts: new Date().toISOString(),
  }));

  for (const conv of conversations) {
    await analyzeQueue.add('analyze', { conversationId: conv.id });
    console.log(JSON.stringify({
      msg: 'enqueued',
      conversationId: conv.id,
      title: (conv.title || '').slice(0, 60),
      turns: conv._count.turns,
      ts: new Date().toISOString(),
    }));
  }

  console.log(JSON.stringify({
    msg: 'Backfill complete. Speaker attribution runs as the worker processes each job.',
    enqueued: conversations.length,
    ts: new Date().toISOString(),
  }));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'ERROR', msg: 'Backfill failed', error: String(err), ts: new Date().toISOString() }));
  process.exit(1);
});
