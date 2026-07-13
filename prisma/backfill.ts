/**
 * Backfill: Map existing Episode records into new domain models.
 *
 * Usage: npx tsx prisma/backfill.ts
 *
 * Idempotent: safe to run multiple times.
 * Uses the shared adapter from episode-to-conversation.
 */

import { createFromEpisode, findUnmappedEpisodeIds } from '../src/lib/adapters/episode-to-conversation';

async function main() {
  const unmappedIds = await findUnmappedEpisodeIds();

  console.log(`Found ${unmappedIds.length} unmapped episodes`);

  let count = 0;
  for (const episodeId of unmappedIds) {
    const result = await createFromEpisode(episodeId);
    if (result) count++;
  }

  console.log(`Backfill complete: ${count}/${unmappedIds.length} episodes mapped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // Need dynamic import since Prisma is managed by the adapter
    const { PrismaClient } = await import('../src/generated/prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });
    await prisma.$disconnect();
  });
