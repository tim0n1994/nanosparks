/**
 * Ingest route behavior tests — the A1 critical path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolveUrl: vi.fn(),
  findOrLinkGlobalEpisode: vi.fn(),
  checkIngestGuardrails: vi.fn(),
  getMonthlyQuotaStatus: vi.fn(),
  addIngestJob: vi.fn(),
  getUserTier: vi.fn(),
  auth: vi.fn(),
  rateLimit: vi.fn(),
  loadGuardrailConfig: vi.fn(),
  isValidClerkKey: false,
}));

vi.mock('@/lib/resolvers', () => ({
  resolveUrl: mocks.resolveUrl,
  ResolverError: class ResolverError extends Error {
    kind: string; platform: string;
    constructor(msg: string, kind: string, platform: string) { super(msg); this.kind = kind; this.platform = platform; this.name = 'ResolverError'; }
  },
}));
vi.mock('@/lib/resolvers/cache', () => ({ findOrLinkGlobalEpisode: mocks.findOrLinkGlobalEpisode }));
vi.mock('@/lib/guardrails', () => ({
  checkIngestGuardrails: mocks.checkIngestGuardrails,
  loadGuardrailConfig: mocks.loadGuardrailConfig,
}));
vi.mock('@/lib/quota', () => ({ getMonthlyQuotaStatus: mocks.getMonthlyQuotaStatus }));
vi.mock('@/lib/billing/tier', () => ({
  getUserTier: mocks.getUserTier,
  isPro: (t: string) => t === 'pro',
  monthlyQuotaFor: (t: string) => (t === 'pro' ? 60 : 4),
}));
vi.mock('@/lib/queue/config', () => ({ addIngestJob: mocks.addIngestJob }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/clerk-utils', () => ({ get isValidClerkKey() { return mocks.isValidClerkKey; } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { POST } from '@/app/api/ingest/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const resolvedSingle = {
  platform: 'xiaoyuzhou' as const,
  platformId: 'eid1',
  episodeKey: 'xiaoyuzhou:eid1',
  title: 'T',
  audioUrl: 'https://cdn/a.m4a',
  sourceUrl: 'https://x/episode/eid1',
  durationSec: 3600,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isValidClerkKey = false; // dev mode: skip auth
  mocks.rateLimit.mockResolvedValue({ success: true });
  mocks.checkIngestGuardrails.mockResolvedValue({ ok: true });
  mocks.getUserTier.mockResolvedValue('free');
  mocks.loadGuardrailConfig.mockResolvedValue({
    maxConcurrentPerUser: 1, maxDailyPerUser: 5, maxAudioDurationSec: 14400, costCircuitBreakerCny: 3,
  });
  mocks.getMonthlyQuotaStatus.mockResolvedValue({ used: 0, limit: 4, remaining: 4, canTranscribe: true });
  mocks.addIngestJob.mockResolvedValue('job_1');
});

describe('POST /api/ingest', () => {
  it('skips the pipeline on a cache hit and returns cached:true', async () => {
    mocks.resolveUrl.mockResolvedValue(resolvedSingle);
    mocks.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'conv_1', cached: true, created: false });

    const res = await POST(makeRequest({ url: 'https://x/episode/eid1', mode: 'robot' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.cached).toBe(true);
    expect(data.conversationId).toBe('conv_1');
    expect(mocks.addIngestJob).not.toHaveBeenCalled();
  });

  it('enqueues the pipeline on a cache miss', async () => {
    mocks.resolveUrl.mockResolvedValue(resolvedSingle);
    mocks.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'conv_2', cached: false, created: true });

    const res = await POST(makeRequest({ url: 'https://x/episode/eid1', mode: 'robot' }));
    const data = await res.json();

    expect(data.cached).toBe(false);
    expect(mocks.addIngestJob).toHaveBeenCalledTimes(1);
    expect(mocks.addIngestJob.mock.calls[0][0].conversationId).toBe('conv_2');
  });

  it('returns the multi-episode list for show-level resolves', async () => {
    mocks.resolveUrl.mockResolvedValue({
      ...resolvedSingle,
      isMultiEpisode: true,
      episodes: [{ ...resolvedSingle, episodeKey: 'xiaoyuzhou:eid2' }],
    });

    const res = await POST(makeRequest({ url: 'https://x/podcast/p1', mode: 'robot' }));
    const data = await res.json();

    expect(data.multiEpisode).toBe(true);
    expect(data.episodes).toHaveLength(1);
    expect(mocks.findOrLinkGlobalEpisode).not.toHaveBeenCalled();
  });

  it('rejects when guardrails fail (e.g. duration over limit)', async () => {
    mocks.resolveUrl.mockResolvedValue({ ...resolvedSingle, durationSec: 5 * 3600 });
    mocks.checkIngestGuardrails.mockResolvedValue({ ok: false, reason: 'duration', message: 'too long' });

    const res = await POST(makeRequest({ url: 'https://x/episode/eid1', mode: 'robot' }));
    expect(res.status).toBe(429);
    expect((await res.json()).kind).toBe('duration');
  });

  it('rejects on quota exhaustion only for first-time transcriptions (cache hit exempt)', async () => {
    mocks.resolveUrl.mockResolvedValue(resolvedSingle);
    mocks.getMonthlyQuotaStatus.mockResolvedValue({ used: 4, limit: 4, remaining: 0, canTranscribe: false });

    mocks.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'c', cached: true, created: false });
    const hitRes = await POST(makeRequest({ url: 'https://x/episode/eid1', mode: 'robot' }));
    expect(hitRes.status).toBe(200);

    mocks.findOrLinkGlobalEpisode.mockResolvedValue({ conversationId: 'c2', cached: false, created: true });
    const missRes = await POST(makeRequest({ url: 'https://x/episode/eid1', mode: 'robot' }));
    expect(missRes.status).toBe(429);
    expect((await missRes.json()).kind).toBe('quota_exhausted');
  });

  it('rejects malformed URLs at validation', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url', mode: 'robot' }));
    expect(res.status).toBe(400);
  });

  it('maps ResolverError kinds to the right HTTP status', async () => {
    const { ResolverError } = await import('@/lib/resolvers');
    mocks.resolveUrl.mockRejectedValue(new ResolverError('Spotify 独占', 'spotify_exclusive', 'spotify'));
    const res = await POST(makeRequest({ url: 'https://open.spotify.com/episode/x', mode: 'robot' }));
    expect(res.status).toBe(422);
  });
});
