import { describe, it, expect } from 'vitest';
import { normalizeName, pickBestCandidate, type PodcastCandidate } from '@/lib/resolvers/discover';

const mk = (over: Partial<PodcastCandidate>): PodcastCandidate => ({
  collectionId: 1, collectionName: '', artistName: '', feedUrl: 'http://feed', artworkUrl600: null, trackCount: 0, ...over,
});

describe('normalizeName', () => {
  it('lowercases, strips punctuation/whitespace, drops trailing "podcast"', () => {
    expect(normalizeName('The 20VC Podcast!')).toBe('the20vc');
    expect(normalizeName('Live in the Future')).toBe('liveinthefuture');
  });
  it('normalizes fullwidth via NFKC', () => {
    expect(normalizeName('ＡＢ')).toBe('ab');
  });
});

describe('pickBestCandidate', () => {
  it('exact normalized-name match with a feed wins', () => {
    const cs = [
      mk({ collectionName: 'Other Show', feedUrl: 'http://other' }),
      mk({ collectionName: 'Live in the Future', feedUrl: 'http://good' }),
    ];
    const r = pickBestCandidate('Live in the Future', cs);
    expect(r?.candidate.feedUrl).toBe('http://good');
    expect(r?.method).toBe('exact');
  });

  it('falls back to first candidate with a feed when no exact match', () => {
    const cs = [
      mk({ collectionName: 'Unrelated', feedUrl: null }),
      mk({ collectionName: 'Different', feedUrl: 'http://first-feed' }),
    ];
    const r = pickBestCandidate('No Match Title', cs);
    expect(r?.candidate.feedUrl).toBe('http://first-feed');
    expect(r?.method).toBe('first_with_feed');
  });

  it('returns null when no candidate has a feed', () => {
    expect(pickBestCandidate('X', [mk({ feedUrl: null })])).toBeNull();
    expect(pickBestCandidate('X', [])).toBeNull();
  });
});
