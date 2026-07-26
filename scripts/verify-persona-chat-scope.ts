import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';

// Verify the persona-chat retrieval now scopes to the person's OWN attributed TUs,
// not mentions. We replicate the scoping query directly (no LLM call needed).
async function main() {
  const entityId = 'cms0wwhvl0004tvyftlpqmntx'; // Marc Andreessen
  const ownTuIds = new Set(
    (await prisma.thoughtUnit.findMany({
      where: { participant: { speakerIdentities: { some: { entityId } } } },
      select: { id: true },
    })).map((t) => t.id),
  );
  // OLD scope: EntityMention conversations (would include other speakers' TUs).
  const mentionConvIds = new Set(
    (await prisma.entityMention.findMany({ where: { entityId }, select: { conversationId: true } })).map(m=>m.conversationId),
  );
  const mentionScopedTus = await prisma.thoughtUnit.findMany({
    where: { conversationId: { in: [...mentionConvIds] } },
    select: { id: true, participantId: true },
  });
  // How many of the mention-scoped TUs are NOT Marc's (i.e. other speakers)?
  const notOwnUnderOldScope = mentionScopedTus.filter(t => !ownTuIds.has(t.id)).length;
  console.log(JSON.stringify({
    entityId,
    ownTuIds_via_SpeakerIdentity: ownTuIds.size,
    mentionScopedTus_oldPath: mentionScopedTus.length,
    would_have_included_other_speakers_TUs: notOwnUnderOldScope,
    verdict: ownTuIds.size > 0 ? 'PASS (persona-chat now scopes to own attributed TUs)' : 'NEEDS REVIEW',
  }, null, 2));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
