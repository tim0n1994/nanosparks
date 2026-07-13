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
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.$disconnect();
  });
