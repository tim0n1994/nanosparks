import { describe, it, expect } from 'vitest';
import { routeQuery } from '@/lib/rag/query-router';

describe('routeQuery (V2/T-V2-9)', () => {
  it('routes global-leaning questions to global', () => {
    expect(routeQuery('大家怎么看 AI 对就业的影响？').scope).toBe('global');
    expect(routeQuery('总体来说这个主题的趋势是什么').scope).toBe('global');
    expect(routeQuery('What is the overall consensus on remote work across the corpus').scope).toBe('global');
  });

  it('routes person/episode-scoped questions to local', () => {
    expect(routeQuery('他认为远程工作怎么样').scope).toBe('local');
    expect(routeQuery('这一集里嘉宾提到了什么具体观点').scope).toBe('local');
    expect(routeQuery('What did she say specifically about this claim').scope).toBe('local');
  });

  it('defaults to local (safer for grounded answers)', () => {
    expect(routeQuery('hello').scope).toBe('local');
    expect(routeQuery('').scope).toBe('local');
  });

  it('includes a human-readable reason', () => {
    const r = routeQuery('大家怎么看这个主题');
    expect(r.reason).toMatch(/global=\d+ local=\d+/);
  });
});
