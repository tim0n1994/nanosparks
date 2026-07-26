import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
import { buildHostFingerprint } from '@/lib/person/host-fingerprint';
async function main() {
  const e = await prisma.entity.findFirst({ where: { canonicalName: '小俊', type: 'person' }, select: { id: true, canonicalName: true } });
  if (!e) { console.error('no 小俊'); process.exit(1); }
  const host = await buildHostFingerprint(e.id);
  console.log(JSON.stringify({ name: e.canonicalName, hostFingerprint: host, verdict: host && host.coverage.hostTurns > 0 ? 'PASS (host 问法 distilled)' : 'NEEDS REVIEW' }, null, 2));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
