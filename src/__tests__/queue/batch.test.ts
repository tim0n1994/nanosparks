/**
 * Tests for batch ingest orchestrator (batchIngestEpisodes).
 *
 * Three scenarios:
 *   1. All cached → 0 enqueued, all free reads
 *   2. Quota exhausted → uncached episodes skipped
 *   3. Mixed → cached free, uncached-within-quota enqueued, uncached-over-quota skipped
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks — must be set before importing the module under test.
const cacheMock = vi.hoisted(() => ({ findOrLinkGlobalEpisode: vi.fn() }));
const configMock = vi.hoisted(() => ({ addIngestJob: vi.fn(async () => 'job_1') }));
const quotaMock = vi.hoisted(() => ({ getMonthlyQuotaStatus: vi.fn() }));
const tierMock = vi.hoisted(() => ({
  getUserTier: vi.fn(async () => 'free' as const),
  monthlyQuotaFor: vi.fn(() => 4),
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/resolvers/cache', () => ({ findOrLinkGlobalEpisode: cacheMock.findOrLinkGlobalEpisode }));
vi.mock('@/lib/queue/config', () => ({ addIngestJob: configMock.addIngestJob }));
vi.mock('@/lib/quota', () => ({ getMonthlyQuotaStatus: quotaMock.getMonthlyQuotaStatus }));
vi.mock('@/lib/billing/tier', () => ({
  getUserTier: tierMock.getUserTier,
  monthlyQuotaFor: tierMock.monthlyQuotaFor,
}));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

import { batchIngestEpisodes } from '@/lib/queue/batch';

const EP = (n: number) => ({
  episodeKey: `rss:guid-${n}`,
  audioUrl: `https://example.com/ep-${n}.mp3`,
  sourceUrl: `https://example.com/feed`,
  platform: 'rss',
  title: `Episode ${n}`,
});

function setQuota(remaining: number, limit = 4) {
  quotaMock.getMonthlyQuotaStatus.mockResolvedValue({ used: limit - remaining, limit, remaining, canTranscribe: remaining > 0 });
}

describe('batchIngestEpisodes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('all cached → enqueued all, 0 quota used, 0 addIngestJob calls', async () => {
    setQuota(4);
    // Every episode is a cache hit.
    cacheMock.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'conv', cached: true, created: false });

    const result = await batchIngestEpisodes({ userId: 'u1', episodes: [EP(1), EP(2), EP(3)], mode: 'robot' });

    expect(result.enqueued).toHaveLength(3);
    expect(result.cachedResults).toHaveLength(3);
    expect(configMock.addIngestJob).not.toHaveBeenCalled();
    expect(result.skippedQuota).toBe(0);
    expect(result.quotaUsed).toBe(0);
    expect(result.quotaLimit).toBe(4);
  });

  it('quota exhausted → all uncached episodes skipped', async () => {
    setQuota(0); // no quota left
    cacheMock.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'conv', cached: false, created: true });

    const result = await batchIngestEpisodes({ userId: 'u1', episodes: [EP(1), EP(2)], mode: 'robot' });

    expect(result.enqueued).toHaveLength(0);
    expect(configMock.addIngestJob).not.toHaveBeenCalled();
    expect(result.skippedQuota).toBe(2);
    expect(result.quotaUsed).toBe(0);
  });

  it('mixed: cached free, within-quota enqueued, over-quota skipped', async () => {
    // 5 episodes: ep1 cached(free), ep2+ep3 new (quota 2 → fits), ep4+ep5 new (quota 0 → skipped)
    setQuota(2);
    cacheMock.findOrLinkGlobalEpisode
      .mockResolvedValueOnce({ conversationId: 'conv-1', cached: true, created: false })  // ep1 cached
      .mockResolvedValueOnce({ conversationId: 'conv-2', cached: false, created: true })  // ep2 new
      .mockResolvedValueOnce({ conversationId: 'conv-3', cached: false, created: true })  // ep3 new
      .mockResolvedValueOnce({ conversationId: 'conv-4', cached: false, created: true })  // ep4 new (over quota)
      .mockResolvedValueOnce({ conversationId: 'conv-5', cached: false, created: true }); // ep5 new (over quota)

    const result = await batchIngestEpisodes({ userId: 'u1', episodes: [EP(1), EP(2), EP(3), EP(4), EP(5)], mode: 'robot' });

    // ep1 cached(free) + ep2 + ep3 enqueued = 3 in enqueued
    expect(result.enqueued).toHaveLength(3);
    expect(result.cachedResults).toHaveLength(1);
    expect(configMock.addIngestJob).toHaveBeenCalledTimes(2); // only ep2, ep3 (ep1 was cached)
    expect(result.skippedQuota).toBe(2); // ep4, ep5
    expect(result.quotaUsed).toBe(2);
  });

  it('skips episodes with unparseable episodeKey', async () => {
    setQuota(4);
    cacheMock.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'conv', cached: false, created: true });

    const result = await batchIngestEpisodes({
      userId: 'u1',
      episodes: [{ ...EP(1), episodeKey: 'no-colon-here' }],
      mode: 'robot',
    });

    expect(result.enqueued).toHaveLength(0);
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
