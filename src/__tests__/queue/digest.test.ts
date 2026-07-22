import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock, ingestQueueMock, rssMock } = vi.hoisted(() => ({
  prismaMock: {
    source: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    follow: { count: vi.fn() },
    globalEpisode: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    conversation: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn(), create: vi.fn() },
    corpus: { findFirst: vi.fn(), create: vi.fn() },
  },
  ingestQueueMock: { add: vi.fn() },
  rssMock: { parseRssFeed: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/queue/config', () => ({ ingestQueue: ingestQueueMock, digestQueue: { add: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/resolvers/rss-parser', () => ({ parseRssFeed: rssMock.parseRssFeed }));

const { processDigestJob } = await import('@/lib/queue/jobs/digest');

const feedEpisode = (guid: string, title: string) => ({
  guid,
  title,
  description: 'd',
  enclosureUrl: `https://cdn.example.com/${guid}.mp3`,
  durationSec: 3600,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no followed sources.
  prismaMock.source.findMany.mockResolvedValue([]);
  // Default workspace/corpus for the system user cache-link path.
  prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws_sys' });
  prismaMock.workspace.create.mockResolvedValue({ id: 'ws_sys' });
  prismaMock.corpus.findFirst.mockResolvedValue({ id: 'corpus_sys' });
  prismaMock.corpus.create.mockResolvedValue({ id: 'corpus_sys' });
  prismaMock.conversation.create.mockResolvedValue({ id: 'conv_new' });
  prismaMock.conversation.update.mockResolvedValue({});
  prismaMock.conversation.findFirst.mockResolvedValue(null);
  prismaMock.globalEpisode.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.globalEpisode.create.mockResolvedValue({ id: 'ge_new' });
  prismaMock.source.findFirst.mockResolvedValue(null);
  prismaMock.source.create.mockResolvedValue({ id: 'src_new' });
});

describe('processDigestJob', () => {
  it('polls zero sources when none have followers', async () => {
    const result = await processDigestJob();
    expect(result.sourcesPolled).toBe(0);
    expect(result.newEpisodesEnqueued).toBe(0);
  });

  it('skips episodes already in the global cache', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { id: 'src_1', feedUrl: 'https://feed.xml', platform: 'rss', uri: null },
    ]);
    prismaMock.follow.count.mockResolvedValue(3); // 3 followers
    rssMock.parseRssFeed.mockResolvedValue({
      title: 'Show',
      episodes: [feedEpisode('g1', 'Old Ep'), feedEpisode('g2', 'Cached Ep')],
    });
    prismaMock.globalEpisode.findUnique.mockResolvedValue({ id: 'ge_existing' }); // both cached

    const result = await processDigestJob();
    expect(result.sourcesPolled).toBe(1);
    expect(result.skippedCached).toBe(2);
    expect(result.newEpisodesEnqueued).toBe(0);
    expect(ingestQueueMock.add).not.toHaveBeenCalled();
  });

  it('enqueues uncached new episodes into the shared cache', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { id: 'src_1', feedUrl: 'https://feed.xml', platform: 'rss', uri: null },
    ]);
    prismaMock.follow.count.mockResolvedValue(1);
    rssMock.parseRssFeed.mockResolvedValue({
      title: 'Show',
      episodes: [feedEpisode('g1', 'New Ep')],
    });
    prismaMock.globalEpisode.findUnique.mockResolvedValue(null); // not cached

    const result = await processDigestJob();
    expect(result.newEpisodesEnqueued).toBe(1);
    expect(ingestQueueMock.add).toHaveBeenCalledTimes(1);
    const payload = ingestQueueMock.add.mock.calls[0][1];
    expect(payload.conversationId).toBe('conv_new');
    expect(payload.audioUrl).toBe('https://cdn.example.com/g1.mp3');
  });

  it('records errors for sources whose feed fails without crashing', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { id: 'src_1', feedUrl: 'https://bad.xml', platform: 'rss', uri: null },
    ]);
    prismaMock.follow.count.mockResolvedValue(1);
    rssMock.parseRssFeed.mockRejectedValue(new Error('feed down'));

    const result = await processDigestJob();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('src_1');
    expect(result.newEpisodesEnqueued).toBe(0);
  });

  it('ignores sources with no followers', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { id: 'src_1', feedUrl: 'https://feed.xml', platform: 'rss', uri: null },
    ]);
    prismaMock.follow.count.mockResolvedValue(0); // no followers

    const result = await processDigestJob();
    expect(result.sourcesPolled).toBe(0);
    expect(rssMock.parseRssFeed).not.toHaveBeenCalled();
  });
});
