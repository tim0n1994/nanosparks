/**
 * One-shot backfill: generate BGE-M3 embeddings for all ThoughtUnits.
 *
 * Run: EMBEDDING_* env set + npx tsx scripts/backfill-embeddings.ts
 * Requires: llama.cpp embedding server on EMBEDDING_BASE_URL.
 *
 * Idempotent: storeEmbedding does ON CONFLICT upsert, so reruns just refresh.
 */
import { prisma } from '../src/lib/prisma';
import { generateEmbeddings } from '../src/lib/embeddings';
import { storeEmbeddings } from '../src/lib/embeddings/search';

const BATCH_SIZE = 64;

async function main() {
  const tus = await prisma.thoughtUnit.findMany({
    select: { id: true, text: true, conversationId: true },
  });
  console.log(`Found ${tus.length} thought units to embed`);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < tus.length; i += BATCH_SIZE) {
    const chunk = tus.slice(i, i + BATCH_SIZE);
    try {
      const vectors = await generateEmbeddings(chunk.map((t) => t.text));
      await storeEmbeddings(
        chunk.map((t, j) => ({
          resourceType: 'thought_unit',
          resourceId: t.id,
          vector: vectors[j],
          model: process.env.EMBEDDING_MODEL ?? 'bge-m3',
        })),
      );
      done += chunk.length;
      if (done % 256 === 0) console.log(`  ${done}/${tus.length} (${Math.round((done / tus.length) * 100)}%)`);
    } catch (err) {
      failed += chunk.length;
      console.error(`Batch failed at ${i}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`Done: ${done} embedded, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
