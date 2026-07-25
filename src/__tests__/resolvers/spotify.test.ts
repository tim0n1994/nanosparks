import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spotifyResolver } from '@/lib/resolvers/spotify';
import { ResolverError } from '@/lib/resolvers/types';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function ok(json: unknown): Response {
  return { ok: true, json: async () => json } as unknown as Response;
}

beforeEach(() => mockFetch.mockReset());

describe('spotifyResolver', () => {
  it('routes open.spotify.com urls', () => {
    expect(spotifyResolver.canHandle('https://open.spotify.com/show/abc')).toBe(true);
    expect(spotifyResolver.canHandle('https://youtube.com/watch?v=x')).toBe(false);
  });

  it('returns an RSS hint when iTunes finds a same-name feed', async () => {
    // 1st call: oEmbed; 2nd: iTunes search
    mockFetch
      .mockResolvedValueOnce(ok({ title: 'Some Show', type: 'podcast' }))
      .mockResolvedValueOnce(ok({ resultCount: 1, results: [{ feedUrl: 'https://rss.example.com/show', artworkUrl600: 'http://art.jpg', collectionName: 'Some Show' }] }));
    const r = await spotifyResolver.resolve('https://open.spotify.com/show/abc', {});
    expect(r.isMultiEpisode).toBe(true);
    expect(r.audioUrl).toBe('https://rss.example.com/show');
    expect(r.title).toBe('Some Show');
  });

  it('throws spotify_exclusive with actionable alternatives when no feed found', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ title: 'Live in the Future', type: 'video' }))
      .mockResolvedValueOnce(ok({ resultCount: 0, results: [] }));
    // capture the thrown error to assert both kind and message in one resolve.
    let caught: ResolverError | undefined;
    try {
      await spotifyResolver.resolve('https://open.spotify.com/show/7qZ', {});
    } catch (e) {
      caught = e as ResolverError;
    }
    expect(caught).toBeInstanceOf(ResolverError);
    expect(caught!.kind).toBe('spotify_exclusive');
    expect(caught!.platform).toBe('spotify');
    // message must mention concrete alternatives (RSS / Apple)
    expect(caught!.message).toMatch(/RSS/);
    expect(caught!.message).toMatch(/Apple/);
  });

  it('wraps oEmbed network failure as ResolverError (not a bare TypeError → 500)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(spotifyResolver.resolve('https://open.spotify.com/show/abc', {})).rejects.toBeInstanceOf(ResolverError);
  });

  it('classifies oEmbed 404 as not_found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    await expect(spotifyResolver.resolve('https://open.spotify.com/show/bad', {})).rejects.toMatchObject({ kind: 'not_found' });
  });
});
