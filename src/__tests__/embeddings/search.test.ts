/**
 * Tests for pgvector similarity search (src/lib/embeddings/search.ts)
 *
 * Covers:
 * - vectorSearch: normal, with resourceType filter, empty results, SQL error
 * - searchThoughtUnits: normal join, empty results, SQL error
 * - storeEmbedding: successful upsert, SQL error
 * - storeEmbeddings: batch with partial errors, empty batch
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Hoisted mocks (must be before vi.mock) ──

const prismaMock = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
  $executeRawUnsafe: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
}));

// ─── Module under test ──

import {
  vectorSearch,
  searchThoughtUnits,
  storeEmbedding,
  storeEmbeddings,
} from '@/lib/embeddings/search';
import type { VectorSearchOptions } from '@/lib/embeddings/search';

// ─── Fixtures ──

const QUERY_VECTOR = [0.1, 0.2, 0.3, 0.4, 0.5];

const MOCK_RAW_ROWS = [
  { id: 'emb_1', resource_type: 'thought_unit', resource_id: 'tu_1', similarity: 0.92 },
  { id: 'emb_2', resource_type: 'thought_unit', resource_id: 'tu_2', similarity: 0.85 },
  { id: 'emb_3', resource_type: 'thought_unit', resource_id: 'tu_3', similarity: 0.73 },
];

const MOCK_JOIN_ROWS = [
  { id: 'emb_1', resource_id: 'tu_1', similarity: 0.92, text: 'Climate change is accelerating', type: 'claim' },
  { id: 'emb_2', resource_id: 'tu_2', similarity: 0.85, text: 'Renewable energy costs dropped 90%', type: 'evidence' },
];

// ===================================================================
// vectorSearch
// ===================================================================

describe('vectorSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mapped results from raw SQL query', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue(MOCK_RAW_ROWS);

    const results = await vectorSearch(QUERY_VECTOR);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      id: 'emb_1',
      resourceType: 'thought_unit',
      resourceId: 'tu_1',
      similarity: 0.92,
    });
    expect(results[2]).toEqual({
      id: 'emb_3',
      resourceType: 'thought_unit',
      resourceId: 'tu_3',
      similarity: 0.73,
    });
  });

  it('passes query vector as PostgreSQL array literal in the SQL', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await vectorSearch(QUERY_VECTOR);

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('[0.1,0.2,0.3,0.4,0.5]::vector');
  });

  it('includes resourceType filter when provided', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await vectorSearch(QUERY_VECTOR, { resourceType: 'conversation' });

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("e.resource_type = 'conversation'");
  });

  it('omits resourceType filter from WHERE when not provided', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue(MOCK_RAW_ROWS);

    await vectorSearch(QUERY_VECTOR);

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    // Should still have WHERE 1=1 structure
    expect(sql).toContain('WHERE 1=1');
    // No AND resource_type filter (e.resource_type appears in SELECT, which is fine)
    expect(sql).not.toContain('AND e.resource_type');
  });

  it('uses default limit when not provided', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await vectorSearch(QUERY_VECTOR);

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('LIMIT 10');
  });

  it('uses custom limit when provided', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await vectorSearch(QUERY_VECTOR, { limit: 5 });

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('LIMIT 5');
  });

  it('uses custom minSimilarity', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await vectorSearch(QUERY_VECTOR, { minSimilarity: 0.7 });

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('>= 0.7');
  });

  it('returns empty array when no results found', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const results = await vectorSearch(QUERY_VECTOR);

    expect(results).toEqual([]);
  });

  it('throws on SQL error with descriptive message', async () => {
    prismaMock.$queryRawUnsafe.mockRejectedValue(new Error('relation "embeddings" does not exist'));

    await expect(vectorSearch(QUERY_VECTOR)).rejects.toThrow(
      'Vector search failed: relation "embeddings" does not exist',
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Vector search failed',
      expect.objectContaining({ error: expect.stringContaining('embeddings') }),
    );
  });

  it('sanitizes single quotes in resourceType filter', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    // Single quote injection attempt
    await vectorSearch(QUERY_VECTOR, { resourceType: "test' OR '1'='1" });

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    // Single quote should be escaped (doubled)
    expect(sql).toContain("e.resource_type = 'test'' OR ''1''=''1'");
  });
});

// ===================================================================
// searchThoughtUnits
// ===================================================================

describe('searchThoughtUnits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns results with text and type from ThoughtUnit join', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue(MOCK_JOIN_ROWS);

    const results = await searchThoughtUnits(QUERY_VECTOR);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'emb_1',
      resourceType: 'thought_unit',
      resourceId: 'tu_1',
      similarity: 0.92,
      text: 'Climate change is accelerating',
      type: 'claim',
    });
  });

  it('joins with ThoughtUnit table', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await searchThoughtUnits(QUERY_VECTOR);

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('JOIN "ThoughtUnit" tu');
    expect(sql).toContain('ON tu.id = e.resource_id');
    expect(sql).toContain("e.resource_type = 'thought_unit'");
  });

  it('respects maxTextLength option', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await searchThoughtUnits(QUERY_VECTOR, { maxTextLength: 100 });

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('LEFT(tu.text, 100)');
  });

  it('defaults maxTextLength to 500', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await searchThoughtUnits(QUERY_VECTOR);

    const sql = prismaMock.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('LEFT(tu.text, 500)');
  });

  it('returns empty array when no results found', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const results = await searchThoughtUnits(QUERY_VECTOR);

    expect(results).toEqual([]);
  });

  it('throws on SQL error with descriptive message', async () => {
    prismaMock.$queryRawUnsafe.mockRejectedValue(
      new Error('relation "ThoughtUnit" does not exist'),
    );

    await expect(searchThoughtUnits(QUERY_VECTOR)).rejects.toThrow(
      'Thought unit search failed: relation "ThoughtUnit" does not exist',
    );
    expect(loggerMock.error).toHaveBeenCalled();
  });
});

// ===================================================================
// storeEmbedding
// ===================================================================

describe('storeEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes upsert SQL with positional parameters', async () => {
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);

    await storeEmbedding('thought_unit', 'tu_1', QUERY_VECTOR, 'text-embedding-3-small');

    // Check the SQL template
    const sql = prismaMock.$executeRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO embeddings');
    expect(sql).toContain('ON CONFLICT (resource_type, resource_id)');
    expect(sql).toContain('DO UPDATE SET');

    // Check positional parameters
    const params = prismaMock.$executeRawUnsafe.mock.calls[0].slice(1);
    expect(params[0]).toBe('thought_unit');
    expect(params[1]).toBe('tu_1');
    expect(params[2]).toBe('[0.1,0.2,0.3,0.4,0.5]');
    expect(params[3]).toBe('text-embedding-3-small');
  });

  it('throws on SQL error with descriptive message', async () => {
    prismaMock.$executeRawUnsafe.mockRejectedValue(
      new Error('null value in column "embedding" violates not-null constraint'),
    );

    await expect(
      storeEmbedding('thought_unit', 'tu_bad', [], 'text-embedding-3-small'),
    ).rejects.toThrow('Failed to store embedding');
    expect(loggerMock.error).toHaveBeenCalled();
  });
});

// ===================================================================
// storeEmbeddings
// ===================================================================

describe('storeEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores multiple embeddings in batch', async () => {
    prismaMock.$executeRawUnsafe.mockResolvedValue(1);

    await storeEmbeddings([
      { resourceType: 'thought_unit', resourceId: 'tu_1', vector: [0.1, 0.2], model: 'm1' },
      { resourceType: 'thought_unit', resourceId: 'tu_2', vector: [0.3, 0.4], model: 'm1' },
      { resourceType: 'thought_unit', resourceId: 'tu_3', vector: [0.5, 0.6], model: 'm1' },
    ]);

    // Should call storeEmbedding for each entry
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('does nothing when entries array is empty', async () => {
    await storeEmbeddings([]);

    expect(prismaMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('continues processing remaining entries when one fails (best-effort)', async () => {
    // First call succeeds, second fails, third succeeds
    prismaMock.$executeRawUnsafe
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('Upsert failed'))
      .mockResolvedValueOnce(1);

    await storeEmbeddings([
      { resourceType: 'thought_unit', resourceId: 'tu_ok_1', vector: [0.1], model: 'm1' },
      { resourceType: 'thought_unit', resourceId: 'tu_fail', vector: [0.2], model: 'm1' },
      { resourceType: 'thought_unit', resourceId: 'tu_ok_2', vector: [0.3], model: 'm1' },
    ]);

    // All 3 should be attempted despite the middle failure
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledTimes(3);

    // Warning should be logged for the failed entry
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'Failed to store embedding for thought_unit:tu_fail',
      expect.objectContaining({ error: expect.stringContaining('Upsert failed') }),
    );
  });

  it('continues when all entries fail (graceful degradation)', async () => {
    prismaMock.$executeRawUnsafe.mockRejectedValue(new Error('Connection lost'));

    // Should not throw — batch is best-effort
    await expect(
      storeEmbeddings([
        { resourceType: 'thought_unit', resourceId: 'tu_a', vector: [0.1], model: 'm1' },
        { resourceType: 'thought_unit', resourceId: 'tu_b', vector: [0.2], model: 'm1' },
      ]),
    ).resolves.toBeUndefined();

    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });
});
