import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
import { processNormalizeTurnsJob } from '@/lib/queue/jobs/normalize-turns';
async function main() {
  const convId = process.argv[2];
  const before = await prisma.turn.aggregate({ _count: { _all: true }, where: { conversationId: convId } });
  const beforeNull = await prisma.turn.count({ where: { conversationId: convId, attributionMethod: null } });
  console.log(JSON.stringify({ msg: 'renormalize start', convId, turns: before._count._all, noMethod: beforeNull }));
  await processNormalizeTurnsJob({ conversationId: convId, sourceId: undefined });
  const afterNull = await prisma.turn.count({ where: { conversationId: convId, attributionMethod: null } });
  const methodDist = await prisma.turn.groupBy({ by: ['attributionMethod'], where: { conversationId: convId }, _count: true });
  console.log(JSON.stringify({ msg: 'renormalize done', convId, noMethodAfter: afterNull, methodDist }));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
