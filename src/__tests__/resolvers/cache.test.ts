import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ResolvedEpisode } from '@/lib/resolvers/types';

// ── Prisma mock (hoisted before static imports) ──
const { prismaMock } = vi.hoisted(() => {
  // Each model is a bag of vi.fn()s; tests re-seed return values per-case.
  const mk = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createMany: vi.fn(),
  });
  return {
    prismaMock: {
      workspace: { findUnique: vi.fn(), create: vi.fn() },
      corpus: { findFirst: vi.fn(), create: vi.fn() },
      source: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      globalEpisode: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { findOrLinkGlobalEpisode } = await import('@/lib/resolvers/cache');

const baseResolved: ResolvedEpisode = {
  platform: 'xiaoyuzhou',
  platformId: '65f0a1b2c3d4e5f6a7b8c9d0',
  episodeKey: 'xiaoyuzhou:65f0a1b2c3d4e5f6a7b8c9d0',
  title: 'Test Episode',
  description: 'desc',
  audioUrl: 'https://cdn.example.com/a.m4a',
  durationSec: 3600,
  coverUrl: 'https://img.example.com/c.jpg',
  showTitle: 'Test Show',
  sourceUrl: 'https://www.xiaoyuzhoufm.com/episode/65f0a1b2c3d4e5f6a7b8c9d0',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: user workspace + corpus already exist.
  prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws_1' });
  prismaMock.corpus.findFirst.mockResolvedValue({ id: 'corpus_1' });
  prismaMock.source.findFirst.mockResolvedValue(null);
  prismaMock.source.create.mockResolvedValue({ id: 'src_1' });
  prismaMock.conversation.update.mockResolvedValue({});
  prismaMock.globalEpisode.update.mockResolvedValue({});
});

describe('findOrLinkGlobalEpisode — cache hit', () => {
  it('skips the pipeline and increments readCount on an existing episode', async () => {
    prismaMock.globalEpisode.findUnique.mockResolvedValue({
      id: 'ge_1',
      episodeKey: baseResolved.episodeKey,
      conversationId: 'conv_existing',
      audioUrl: baseResolved.audioUrl, // already backfilled → no audioUrl update needed
      conversation: { id: 'conv_existing', status: 'completed' },
    });

    const result = await findOrLinkGlobalEpisode(baseResolved, 'user_A');

    expect(result.cached).toBe(true);
    expect(result.created).toBe(false);
    expect(result.conversationId).toBe('conv_existing');
    expect(prismaMock.globalEpisode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ge_1' }, data: { readCount: { increment: 1 } } }),
    );
    // Must NOT create a new conversation on a hit.
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    expect(prismaMock.globalEpisode.create).not.toHaveBeenCalled();
  });

  it('backfills audioUrl on a cache hit when the existing record lacks it', async () => {
    prismaMock.globalEpisode.findUnique.mockResolvedValue({
      id: 'ge_1',
      episodeKey: baseResolved.episodeKey,
      conversationId: 'conv_existing',
      audioUrl: null, // missing → should be backfilled from the resolved episode
      conversation: { id: 'conv_existing', status: 'completed' },
    });

    await findOrLinkGlobalEpisode(baseResolved, 'user_A');

    const updateCall = prismaMock.globalEpisode.update.mock.calls[0][0];
    expect(updateCall.data).toMatchObject({
      readCount: { increment: 1 },
      audioUrl: baseResolved.audioUrl,
    });
  });
});

describe('findOrLinkGlobalEpisode — cache miss', () => {
  it('creates a shared conversation + GlobalEpisode and returns cached:false', async () => {
    prismaMock.globalEpisode.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_new' });
    prismaMock.globalEpisode.create.mockResolvedValue({ id: 'ge_new' });

    const result = await findOrLinkGlobalEpisode(baseResolved, 'user_A');

    expect(result.cached).toBe(false);
    expect(result.created).toBe(true);
    expect(result.conversationId).toBe('conv_new');

    const convCall = prismaMock.conversation.create.mock.calls[0][0];
    expect(convCall.data.episodeKey).toBe(baseResolved.episodeKey);
    expect(convCall.data.isSharedCache).toBe(true);

    const geCall = prismaMock.globalEpisode.create.mock.calls[0][0];
    expect(geCall.data.episodeKey).toBe(baseResolved.episodeKey);
    expect(geCall.data.conversationId).toBe('conv_new');
    expect(geCall.data.platform).toBe('xiaoyuzhou');
    expect(geCall.data.readCount).toBe(1);
  });
});

describe('findOrLinkGlobalEpisode — upload privacy boundary', () => {
  it('never reads from or writes to the shared cache when isUpload is true', async () => {
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_private' });

    const result = await findOrLinkGlobalEpisode(baseResolved, 'user_A', { isUpload: true });

    expect(result.cached).toBe(false);
    expect(result.conversationId).toBe('conv_private');
    // Uploads must not touch the global cache at all.
    expect(prismaMock.globalEpisode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.globalEpisode.create).not.toHaveBeenCalled();

    const convCall = prismaMock.conversation.create.mock.calls[0][0];
    expect(convCall.data.episodeKey).toBeNull();
    expect(convCall.data.isSharedCache).toBe(false);
  });
});

describe('findOrLinkGlobalEpisode — per-user corpus bootstrap', () => {
  it('creates a workspace + corpus when none exist for the user', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    prismaMock.workspace.create.mockResolvedValue({ id: 'ws_new' });
    prismaMock.corpus.findFirst.mockResolvedValue(null);
    prismaMock.corpus.create.mockResolvedValue({ id: 'corpus_new' });
    prismaMock.globalEpisode.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_new' });
    prismaMock.globalEpisode.create.mockResolvedValue({ id: 'ge_new' });

    await findOrLinkGlobalEpisode(baseResolved, 'user_new');

    expect(prismaMock.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkId: 'user_new' }) }),
    );
    expect(prismaMock.corpus.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'ws_new', name: 'My Library' }) }),
    );
  });
});
describe('findOrLinkGlobalEpisode — show-level feedUrl (C3)', () => {
  it('persists feedUrl for multi-episode RSS sources so the digest worker can poll', async () => {
    const showResolved: ResolvedEpisode = {
      ...baseResolved,
      platform: 'rss',
      episodeKey: 'rss:https://feed.xml',
      sourceUrl: 'https://feed.xml',
      isMultiEpisode: true,
    };
    prismaMock.globalEpisode.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_show' });
    prismaMock.globalEpisode.create.mockResolvedValue({ id: 'ge_show' });
    prismaMock.source.update.mockResolvedValue({});

    await findOrLinkGlobalEpisode(showResolved, 'user_A');

    const updateCall = prismaMock.source.update.mock.calls[0]?.[0];
    expect(updateCall?.data?.feedUrl).toBe('https://feed.xml');
  });

  it('does not set feedUrl for single-episode sources', async () => {
    prismaMock.globalEpisode.findUnique.mockResolvedValue(null);
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_ep' });
    prismaMock.globalEpisode.create.mockResolvedValue({ id: 'ge_ep' });

    await findOrLinkGlobalEpisode(baseResolved, 'user_A');

    expect(prismaMock.source.update).not.toHaveBeenCalled();
  });
});
