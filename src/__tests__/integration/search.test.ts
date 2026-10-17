/**
 * Integration tests for pgvector similarity search against the real DB.
 *
 * Uses the live embeddings table (20754 bge-m3 vectors at 1024d).
 * No mocks — these tests prove the SQL + pgvector + Prisma.sql pipeline
 * works end to end.
 *
 * Run: DATABASE_URL=... npx vitest run src/__tests__/integration/search.test.ts
 */
import { prisma } from '@/lib/prisma';
import { describe, it, expect, beforeAll } from 'vitest';
import { vectorSearch, searchThoughtUnits, storeEmbedding } from '@/lib/embeddings/search';
import net from 'node:net';

/** Quick TCP probe: is the configured Postgres actually reachable right now? */
async function probeDb(url: string): Promise<boolean> {
  let host = 'localhost';
  let port = 5432;
  try {
    const u = new URL(url);
    host = u.hostname || host;
    port = u.port ? Number(u.port) : port;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

const databaseUrl = process.env.DATABASE_URL;
const wantRun = Boolean(databaseUrl) && process.env.SKIP_INTEGRATION !== 'true';
// Configured-but-unreachable (DB down) must skip, not fail the suite.
const reachable = wantRun && databaseUrl ? await probeDb(databaseUrl) : false;

const skipDescribe = reachable ? describe : describe.skip;

skipDescribe('pgvector search (integration)', () => {
  let testVector: number[];

  beforeAll(async () => {
    // Grab a real embedding vector to use as the query — avoids needing
    // the embedding server running for these tests.

    const row = await prisma.$queryRaw<{ embedding: string }[]>`
      SELECT embedding::text FROM embeddings LIMIT 1
    `;
    testVector = row[0]?.embedding
      ?.replace(/[\[\]]/g, '')
      .split(',')
      .map(Number) ?? [0.1, 0.2];
  });

  it('vectorSearch returns results ordered by similarity', async () => {
    const results = await vectorSearch(testVector, { limit: 5, minSimilarity: 0.3 });
    expect(results.length).toBeGreaterThan(0);
    // Results should be sorted descending by similarity
    for (let i = 1; i < results.length; i++) {
      expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
    }
  });

  it('vectorSearch respects limit', async () => {
    const results = await vectorSearch(testVector, { limit: 3, minSimilarity: 0.3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('vectorSearch respects minSimilarity threshold', async () => {
    const results = await vectorSearch(testVector, { limit: 10, minSimilarity: 0.95 });
    for (const r of results) {
      expect(r.similarity).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('vectorSearch filters by resourceType', async () => {
    const results = await vectorSearch(testVector, {
      limit: 5,
      minSimilarity: 0.3,
      resourceType: 'thought_unit',
    });
    for (const r of results) {
      expect(r.resourceType).toBe('thought_unit');
    }
  });

  it('searchThoughtUnits returns text + type from join', async () => {
    const results = await searchThoughtUnits(testVector, { limit: 3, minSimilarity: 0.3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toBeTruthy();
    expect(results[0].type).toBeTruthy();
    expect(typeof results[0].text).toBe('string');
  });

  it('searchThoughtUnits truncates text to maxTextLength', async () => {
    const results = await searchThoughtUnits(testVector, { limit: 1, minSimilarity: 0.3, maxTextLength: 50 });
    for (const r of results) {
      expect(r.text.length).toBeLessThanOrEqual(50);
    }
  });

  it('storeEmbedding upserts and round-trips', async () => {
    const testId = 'test-integration-search-roundtrip';
    const v = Array(1024).fill(0).map((_, i) => i * 0.001);

    await storeEmbedding('thought_unit', testId, v, 'bge-m3-test');

    // Verify it's retrievable
    
    const rows = await prisma.$queryRaw<{ model: string }[]>`
      SELECT model FROM embeddings WHERE resource_id = ${testId}
    `;
    expect(rows[0]?.model).toBe('bge-m3-test');

    // Cleanup
    await prisma.$executeRaw`DELETE FROM embeddings WHERE resource_id = ${testId}`;
  });
});
