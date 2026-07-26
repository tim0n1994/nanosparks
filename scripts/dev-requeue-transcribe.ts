/**
 * Dev utility: reset failed conversations and enqueue transcribe directly
 * (same as the /reprocess route, but with a fresh redis connection — the dev
 * server's queue connection can be stale). transcribe self-chains analyze.
 * Usage: npx tsx scripts/dev-requeue-transcribe.ts <conversationId ...>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { transcribeQueue } from '@/lib/queue/config';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('usage: dev-requeue-transcribe.ts <conversationId ...>');
    process.exit(1);
  }
  const out = [];
  for (const conversationId of ids) {
    await prisma.turn.deleteMany({ where: { conversationId } });
    await prisma.participant.deleteMany({ where: { conversationId } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'pending' } });
    const job = await transcribeQueue.add('transcribe', { conversationId });
    out.push({ conversationId, jobId: job.id });
  }
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
