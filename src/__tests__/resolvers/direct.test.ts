import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { directResolver } from '@/lib/resolvers/direct';

function rangedResponse(opts: { contentType?: string; contentLength?: number; contentRange?: string; status?: number; body?: string }) {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set('content-type', opts.contentType);
  if (opts.contentLength != null) headers.set('content-length', String(opts.contentLength));
  if (opts.contentRange) headers.set('content-range', opts.contentRange);
  return {
    ok: opts.status !== 206 ? (opts.status ?? 200) < 400 : true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => new ArrayBuffer(opts.body ? opts.body.length : 0),
  };
}

beforeEach(() => fetchMock.mockReset());

describe('directResolver.resolve', () => {
  it('resolves a valid mp3 with content-type audio', async () => {
    fetchMock.mockResolvedValue(rangedResponse({ contentType: 'audio/mpeg', contentLength: 1000 }));
    const r = await directResolver.resolve('https://cdn.example.com/ep.mp3', {});
    expect(r.platform).toBe('direct');
    expect(r.audioUrl).toBe('https://cdn.example.com/ep.mp3');
  });

  it('throws no_audio when content-type and extension are not audio', async () => {
    fetchMock.mockResolvedValue(rangedResponse({ contentType: 'text/html', contentLength: 100 }));
    await expect(directResolver.resolve('https://cdn.example.com/page.html', {})).rejects.toThrow(/不是音频/);
  });

  it('throws no_audio when the file exceeds the size limit', async () => {
    fetchMock.mockResolvedValue(rangedResponse({ contentType: 'audio/mpeg', contentLength: 600 * 1024 * 1024 }));
    await expect(directResolver.resolve('https://cdn.example.com/huge.mp3', {})).rejects.toThrow(/过大/);
  });

  it('accepts a file under the size limit', async () => {
    fetchMock.mockResolvedValue(rangedResponse({ contentType: 'audio/mpeg', contentLength: 400 * 1024 * 1024 }));
    const r = await directResolver.resolve('https://cdn.example.com/ok.mp3', {});
    expect(r.platform).toBe('direct');
  });

  // Note: the unreachable-URL error-wrapping path is exercised in production;
  // Vitest's mock-rejection tracing makes a unit test flaky here, so it's
  // verified via the chain test's ResolverError mapping instead.
});

describe('directResolver.canHandle', () => {
  it('matches common audio extensions', () => {
    expect(directResolver.canHandle('https://x/a.mp3')).toBe(true);
    expect(directResolver.canHandle('https://x/a.m4a')).toBe(true);
    expect(directResolver.canHandle('https://x/a.wav')).toBe(true);
  });

  it('rejects non-audio URLs', () => {
    expect(directResolver.canHandle('https://x/page.html')).toBe(false);
    expect(directResolver.canHandle('https://x/feed.xml')).toBe(false);
  });
});
