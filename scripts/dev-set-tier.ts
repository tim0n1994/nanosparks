/**
 * Dev utility: set a user's tier Setting (free | pro).
 * Usage: npx tsx scripts/dev-set-tier.ts [userId] [tier]
 * Defaults: dev-user pro (the local-dev account used when Clerk is not configured).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function main() {
  const userId = process.argv[2] ?? 'dev-user';
  const tier = process.argv[3] === 'free' ? 'free' : 'pro';
  const row = await prisma.setting.upsert({
    where: { key: `tier.${userId}` },
    update: { value: tier },
    create: { key: `tier.${userId}`, value: tier },
  });
  console.log(JSON.stringify({ key: row.key, value: row.value }));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
