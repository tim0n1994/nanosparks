import { describe, it, expect } from 'vitest';
import { pickResolver, platformLabel, RESOLVERS } from '@/lib/resolvers';

describe('resolver chain — pickResolver', () => {
  const cases: Array<[string, string]> = [
    ['https://www.xiaoyuzhoufm.com/episode/65f0a1b2c3d4e5f6a7b8c9d0', 'xiaoyuzhou'],
    ['https://xiaoyuzhoufm.com/podcast/65f0a1b2c3d4e5f6a7b8c9d0', 'xiaoyuzhou'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMfO6dlsJI2N6c4ZpV', 'youtube'],
    ['https://www.bilibili.com/video/BV1xx411c7mD', 'bilibili'],
    ['https://b23.tv/abc123', 'bilibili'],
    ['https://podcasts.apple.com/us/podcast/foo/id1234567890', 'apple_podcasts'],
    ['https://open.spotify.com/episode/abc123', 'spotify'],
    ['https://example.com/feed.xml', 'rss'],
    ['https://anchor.fm/s/feed.rss', 'rss'],
    ['https://cdn.example.com/ep42.mp3', 'direct'],
    ['https://cdn.example.com/ep42.m4a', 'direct'],
    ['https://some-unknown-site.example/watch?v=1', 'generic'],
  ];

  it('routes each URL shape to the expected resolver', () => {
    for (const [url, expected] of cases) {
      expect(pickResolver(url).name, `URL: ${url}`).toBe(expected);
    }
  });

  it('never returns undefined (generic fallback always claims)', () => {
    expect(pickResolver('https://totally-unknown.example/page').name).toBe('generic');
    expect(pickResolver('notaurl')).toBeInstanceOf(Object);
  });

  it('generic is the last resolver in priority order', () => {
    expect(RESOLVERS[RESOLVERS.length - 1].name).toBe('generic');
  });

  it('each resolver has a unique name', () => {
    const names = RESOLVERS.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('platformLabel', () => {
  it('returns a human label for every platform', () => {
    for (const r of RESOLVERS) {
      expect(platformLabel(r.name).length).toBeGreaterThan(0);
    }
  });
});
