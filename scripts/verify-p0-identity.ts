/**
 * P0 verification harness: resolve Participant→Entity identities for a
 * conversation and report the resulting person Entities + SpeakerIdentity links.
 *
 * Usage:
 *   npx tsx scripts/verify-p0-identity.ts <conversationId>
 *   npx tsx scripts/verify-p0-identity.ts --auto
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { prisma } from '@/lib/prisma';
import { resolveConversationIdentities } from '@/lib/person/identity-resolver';

function log(o: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...o }));
}

async function main() {
  const arg = process.argv[2];
  let convId = arg === '--auto' || !arg ? null : arg;
  if (!convId) {
    // pick a conversation with named participants (role set) and turns
    const conv = await prisma.participant.findFirst({
      where: { role: { not: null }, conversation: { turns: { some: {} } } },
      select: { conversationId: true },
    });
    convId = conv?.conversationId ?? null;
  }
  if (!convId) { console.error('No conversation with named participants found.'); process.exit(1); }

  const personsBefore = await prisma.entity.count({ where: { type: 'person' } });
  log({ msg: 'p0 verify start', conversationId: convId, personsBefore });

  const r = await resolveConversationIdentities(convId);
  log({ msg: 'resolved', ...r });

  const personsAfter = await prisma.entity.count({ where: { type: 'person' } });
  const si = await prisma.speakerIdentity.findMany({
    where: { participant: { conversationId: convId } },
    include: {
      entity: { select: { canonicalName: true } },
      participant: { select: { name: true, role: true, speakerLabel: true } },
    },
  });
  log({
    msg: 'p0 verify result',
    conversationId: convId,
    personsBefore,
    personsAfter,
    createdPersons: personsAfter - personsBefore,
    links: si.map((s) => ({
      participantName: s.participant.name,
      role: s.participant.role,
      entity: s.entity.canonicalName,
      confidence: s.confidence,
    })),
    verdict: r.linked > 0 ? 'PASS (named speakers linked to Entities)' : 'NEEDS REVIEW',
  });
  await prisma.$disconnect();
}

main().catch((e) => { console.error(JSON.stringify({ msg: 'verify-p0 failed', error: String(e), stack: e?.stack })); process.exit(1); });
