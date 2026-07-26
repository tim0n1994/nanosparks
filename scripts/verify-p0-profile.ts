import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
import { buildPersonProfile } from '@/lib/person/profile-builder';
async function main() {
  // Marc Andreessen entity (created by verify-p0-identity)
  const e = await prisma.entity.findFirst({ where: { canonicalName: 'Marc Andreessen', type: 'person' }, select: { id: true, canonicalName: true } });
  if (!e) { console.log('no entity'); process.exit(1); }
  console.log('building profile for', e.canonicalName, e.id);
  // build without LLM client to isolate stat logic (style step will warn + leave null)
  const r = await buildPersonProfile(e.id, { client: undefined as never }).catch(err => ({ error: String(err) }));
  console.log('build result:', r);
  const p = await prisma.personProfile.findUnique({ where: { entityId: e.id }, select: { statsJson: true, summaryText: true, chatEnabled: true } });
  console.log('profile stats:', JSON.stringify(p));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
