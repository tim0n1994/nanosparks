import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
async function main() {
  const convId = process.argv[2];
  // 把 TU.participantId 清空，再基于 EvidenceSpan->Turn 重新回填
  await prisma.thoughtUnit.updateMany({ where: { conversationId: convId }, data: { participantId: null } });
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversationId: convId },
    select: { id: true, evidenceSpans: { select: { turn: { select: { participantId: true } } }, take: 1 } },
  });
  let remapped = 0;
  for (const tu of tus) {
    const pid = tu.evidenceSpans[0]?.turn?.participantId;
    if (pid) { await prisma.thoughtUnit.update({ where: { id: tu.id }, data: { participantId: pid } }); remapped++; }
  }
  console.log(JSON.stringify({ convId, tus: tus.length, remapped }));
  // 按 participant 看分布
  const dist = await prisma.thoughtUnit.groupBy({ by: ['participantId'], where: { conversationId: convId }, _count: true });
  for (const d of dist) {
    const p = d.participantId ? await prisma.participant.findUnique({ where: { id: d.participantId }, select: { name: true } }) : null;
    console.log(`  ${p?.name ?? '(null)'}: ${d._count}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
