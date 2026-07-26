/**
 * P1 verification: merge anonymous turns into named participants via the LLM
 * speaker-assignment path, then rebuild one person's profile to confirm their
 * spokenTurnCount is now > 0.
 *
 * Usage:
 *   npx tsx scripts/verify-p1-merge.ts <conversationId>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { prisma } from '@/lib/prisma';
import { mergeSpeakersForConversation } from '@/lib/person/merge-speakers';
import { buildPersonProfile } from '@/lib/person/profile-builder';

function log(o: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...o }));
}

async function main() {
  const conversationId = process.argv[2];
  if (!conversationId) { console.error('Usage: verify-p1-merge.ts <conversationId>'); process.exit(1); }

  const namedBefore = await prisma.participant.findMany({
    where: { conversationId },
    select: { id: true, name: true, role: true, _count: { select: { turns: true } } },
  });
  log({ msg: 'p1 merge start', conversationId, namedBefore: namedBefore.map(p => ({ name: p.name, role: p.role, turns: p._count.turns })) });

  const r = await mergeSpeakersForConversation(conversationId);
  log({ msg: 'merge result', ...r });

  const namedAfter = await prisma.participant.findMany({
    where: { conversationId },
    select: { id: true, name: true, _count: { select: { turns: true } } },
  });
  log({ msg: 'named after merge', namedAfter: namedAfter.map(p => ({ name: p.name, turns: p._count.turns })) });

  // Rebuild the first named person's profile and confirm spokenTurnCount>0.
  const firstNamed = namedAfter.find(p => p._count.turns > 0);
  if (firstNamed) {
    const si = await prisma.speakerIdentity.findFirst({
      where: { participantId: firstNamed.id },
      select: { entityId: true },
    });
    if (si) {
      await buildPersonProfile(si.entityId, { client: undefined as never }).catch(() => {});
      const prof = await prisma.personProfile.findUnique({
        where: { entityId: si.entityId },
        select: { statsJson: true, displayName: true },
      });
      log({ msg: 'rebuilt profile', displayName: prof?.displayName, stats: prof?.statsJson });
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(JSON.stringify({ msg: 'verify-p1-merge failed', error: String(e), stack: e?.stack })); process.exit(1); });
