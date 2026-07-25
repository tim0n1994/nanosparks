import { prisma } from './src/lib/prisma';
async function main() {
  const c = await prisma.corpus.findFirst({
    where: { graphNodes: { some: {} } },
    select: { id: true, name: true, _count: { select: { graphNodes: true, graphEdges: true, conversations: true } } },
    orderBy: { graphNodes: { _count: 'desc' } },
  });
  console.log(JSON.stringify(c));
  await prisma.$disconnect();
}
void main();
