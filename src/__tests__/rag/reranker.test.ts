import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerank, type RerankCandidate } from '@/lib/rag/reranker';

describe('rerank', () => {
  const candidates: RerankCandidate[] = [
    { id: 'tu1', text: 'AI alignment requires careful reward modeling', originalScore: 0.032 },
    { id: 'tu2', text: 'Email is researcher@example.com', originalScore: 0.028 },
    { id: 'tu3', text: 'The weather is nice today', originalScore: 0.025 },
    { id: 'tu4', text: 'Neural networks can approximate any function', originalScore: 0.020 },
  ];

  beforeEach(() => {
    vi.stubEnv('RERANKER_PROVIDER', 'none');
  });

  it('skips reranking when provider is none', async () => {
    const results = await rerank('AI alignment', candidates, { provider: 'none', topK: 3 });

    expect(results).toHaveLength(3);
    // Should preserve original order
    expect(results[0].candidate.id).toBe('tu1');
  });

  it('skips reranking when candidates <= topK', async () => {
    const results = await rerank('query', candidates, { provider: 'local', topK: 10 });

    expect(results).toHaveLength(4); // All candidates, no reranking needed
  });

  it('returns empty array for empty candidates', async () => {
    const results = await rerank('query', [], { provider: 'local' });
    expect(results).toEqual([]);
  });

  // Note: local reranker fallback is tested via integration test (requires Python).
  // The unit test for 'none' provider and skip-when-candidates<=topK covers the
  // non-reranking paths. The fallback logic in rerank() catches errors and returns
  // original order — verified by code review and integration tests.

  it('respects topK limit', async () => {
    const results = await rerank('query', candidates, { provider: 'none', topK: 2 });
    expect(results).toHaveLength(2);
  });
});
