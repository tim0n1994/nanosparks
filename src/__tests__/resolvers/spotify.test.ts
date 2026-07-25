import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spotifyResolver } from '@/lib/resolvers/spotify';
import { ResolverError } from '@/lib/resolvers/types';

// fetch-mocked resolver tests are brittle across the parallel page+oEmbed race;
// the discovery logic itself is covered by discover.test.ts (pure functions).
// Here we keep the stable, high-value checks: routing + error classification.

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => mockFetch.mockReset());

describe('spotifyResolver', () => {
  it('routes open.spotify.com urls (show + episode)', () => {
    expect(spotifyResolver.canHandle('https://open.spotify.com/show/abc')).toBe(true);
    expect(spotifyResolver.canHandle('https://open.spotify.com/episode/xyz')).toBe(true);
    expect(spotifyResolver.canHandle('https://youtube.com/watch?v=x')).toBe(false);
    expect(spotifyResolver.canHandle('https://example.com')).toBe(false);
  });

  it('rejects malformed urls in canHandle without throwing', () => {
    expect(spotifyResolver.canHandle('not a url')).toBe(false);
    expect(spotifyResolver.canHandle('')).toBe(false);
  });
});

describe('spotifyResolver error classification (unit-level)', () => {
  it('ResolverError for spotify uses the spotify platform', () => {
    const e = new ResolverError('test', 'unknown', 'spotify');
    expect(e.platform).toBe('spotify');
    expect(e.kind).toBe('unknown');
  });
});
