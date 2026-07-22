import { describe, it, expect } from 'vitest';
import { buildEpisodeKey, parseEpisodeKey, fnv1aHash, contentHashPlatformId } from '@/lib/resolvers/episode-key';

describe('episodeKey', () => {
  describe('buildEpisodeKey', () => {
    it('joins platform + id with a colon', () => {
      expect(buildEpisodeKey('xiaoyuzhou', '65f0a1b2c3d4e5f6a7b8c9d0')).toBe(
        'xiaoyuzhou:65f0a1b2c3d4e5f6a7b8c9d0',
      );
      expect(buildEpisodeKey('youtube', 'dQw4w9WgXcQ')).toBe('youtube:dQw4w9WgXcQ');
    });

    it('is stable across calls (deterministic)', () => {
      expect(buildEpisodeKey('apple_podcasts', '123')).toBe(buildEpisodeKey('apple_podcasts', '123'));
    });
  });

  describe('parseEpisodeKey', () => {
    it('splits a key back into platform + id', () => {
      expect(parseEpisodeKey('xiaoyuzhou:65f0a1b2c3')).toEqual({
        platform: 'xiaoyuzhou',
        platformId: '65f0a1b2c3',
      });
    });

    it('preserves ids that contain colons (first colon is the separator)', () => {
      expect(parseEpisodeKey('rss:https://example.com/feed.xml')).toEqual({
        platform: 'rss',
        platformId: 'https://example.com/feed.xml',
      });
    });

  it('returns null on malformed input', () => {
      expect(parseEpisodeKey('nocolon')).toBeNull();
      expect(parseEpisodeKey('')).toBeNull();
      expect(parseEpisodeKey(':onlyid')).toBeNull();
    });
  });

  describe('fnv1aHash', () => {
  it('returns a stable hash for identical input', () => {
      expect(fnv1aHash('https://example.com/audio.mp3')).toBe(
        fnv1aHash('https://example.com/audio.mp3'),
      );
    });

    it('produces different hashes for different input', () => {
      expect(fnv1aHash('a')).not.toBe(fnv1aHash('b'));
    });
  });

  describe('contentHashPlatformId', () => {
    it('prefixes the hash with ch_ for no-native-id sources', () => {
      const id = contentHashPlatformId({ url: 'https://example.com/a.mp3' });
      expect(id.startsWith('ch_')).toBe(true);
      expect(id.length).toBeGreaterThan(3);
    });

    it('incorporates size + head into the hash so distinct files differ', () => {
      const a = contentHashPlatformId({ url: 'https://x/a.mp3', size: 100 });
      const b = contentHashPlatformId({ url: 'https://x/a.mp3', size: 200 });
      expect(a).not.toBe(b);
    });
  });
});
