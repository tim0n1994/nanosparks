import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
import { promotePersonClaims } from '@/lib/person/claim-promoter';
async function main() {
  const persons = await prisma.entity.findMany({ where: { type: 'person' }, select: { id: true, canonicalName: true } });
  for (const p of persons) {
    const r = await promotePersonClaims(p.id);
    console.log(JSON.stringify({ name: p.canonicalName, promoted: r.promoted }));
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
