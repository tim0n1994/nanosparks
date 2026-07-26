/**
 * Verify the full L0->L3 distillation pipeline (the same chain the analyze job
 * now runs automatically) for a conversation. Runs in-process so it exercises
 * the real wiring without needing the worker.
 *
 * Usage: npx tsx scripts/verify-pipeline.ts <conversationId>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { runDistillationForConversation } from '@/lib/person/distillation-pipeline';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

async function main() {
  const conversationId = process.argv[2];
  if (!conversationId) { console.error('Usage: verify-pipeline.ts <conversationId>'); process.exit(1); }

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true, title: true } });
  log({ msg: 'pipeline verify start', conversationId, title: (conv?.title || '').slice(0, 50) });

  await runDistillationForConversation(conversationId);

  // Report end state.
  const turns = await prisma.turn.aggregate({ _count: { _all: true }, where: { conversationId } });
  const nulls = await prisma.turn.count({ where: { conversationId, participantId: null } });
  const entities = await prisma.entity.findMany({
    where: { speakerIdentities: { some: { participant: { conversationId } } } },
    select: {
      id: true, canonicalName: true,
      _count: { select: { personClaims: true, fingerprints: true } },
    },
  });
  log({
    msg: 'pipeline verify result',
    conversationId,
    turns: turns._count._all,
    nullRate: ((nulls / Math.max(1, turns._count._all)) * 100).toFixed(2) + '%',
    persons: entities.map(e => ({ name: e.canonicalName, claims: e._count.personClaims, fingerprints: e._count.fingerprints })),
    verdict: entities.some(e => e._count.fingerprints > 0) ? 'PASS (full chain produced fingerprints)' : 'PARTIAL (no fingerprint yet)',
  });
  await prisma.$disconnect();
}
main().catch(e => { console.error(JSON.stringify({ msg: 'verify-pipeline failed', error: String(e), stack: e?.stack })); process.exit(1); });
