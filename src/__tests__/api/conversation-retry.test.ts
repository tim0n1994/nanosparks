import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());
import { NextRequest, NextResponse } from 'next/server';

const m = vi.hoisted(() => ({
  access: vi.fn(), find: vi.fn(), updateMany: vi.fn(), deleteTurns: vi.fn(), deleteParticipants: vi.fn(),
  runCreate: vi.fn(), runUpdate: vi.fn(), aggregate: vi.fn(), transcribe: vi.fn(), ingest: vi.fn(), analyze: vi.fn(),
  stat: vi.fn(), fileAccess: vi.fn(), guard: vi.fn(), quota: vi.fn(), storageGet: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock('@/lib/auth/conversation-access', () => ({ requireConversationAccess: m.access }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  conversation: { findUnique: m.find, updateMany: m.updateMany },
  turn: { deleteMany: m.deleteTurns }, participant: { deleteMany: m.deleteParticipants },
  extractionRun: { create: m.runCreate, update: m.runUpdate, aggregate: m.aggregate },
} }));
vi.mock('@/lib/queue/config', () => ({ transcribeQueue: { add: m.transcribe, getJob: m.getJob }, ingestQueue: { add: m.ingest, getJob: m.getJob }, analyzeQueue: { add: m.analyze, getJob: m.getJob } }));
vi.mock('node:fs/promises', () => ({ default: { stat: m.stat, access: m.fileAccess }, stat: m.stat, access: m.fileAccess }));
vi.mock('@/lib/storage/provider', () => ({ createStorageProvider: () => ({ get: m.storageGet }) }));
vi.mock('@/lib/guardrails', () => ({ loadGuardrailConfig: async () => ({}), checkIngestGuardrails: m.guard, costBreakerTripped: (cost: number) => cost > 1 }));
vi.mock('@/lib/quota', () => ({ getMonthlyQuotaStatus: m.quota }));
vi.mock('@/lib/billing/tier', () => ({ getUserTier: async () => 'free', monthlyQuotaFor: () => 4 }));
vi.mock('@/lib/settings', () => ({ getLlmSettings: async () => ({ model: 'default-model' }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { POST as reprocess } from '@/app/api/conversations/[id]/reprocess/route';
import { POST as reextract } from '@/app/api/conversations/[id]/reextract/route';

function request(body = '{}') {
  return new NextRequest('http://localhost/api/conversations/conv_1/reprocess', { method: 'POST', body });
}
const params = { params: Promise.resolve({ id: 'conv_1' }) };
let conversation: {
  id: string; corpusId: string; status: string; updatedAt: Date; title: string; episodeKey: string;
  source: { mediaAssets: { filePath: string | null; storageKey: string | null }[]; uri: string | null; platform: string };
  globalEpisode: { audioUrl: string | null; platformId: string; sourceUrl: string | null; platform: string; durationSec: number };
  _count: { turns: number };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  conversation = { id: 'conv_1', corpusId: 'corpus_1', status: 'failed', updatedAt: new Date('2026-09-01'), title: 'Original title', episodeKey: 'rss:ep_1', source: { mediaAssets: [], uri: null, platform: 'rss' }, globalEpisode: { audioUrl: null, platformId: 'ep_1', sourceUrl: null, platform: 'rss', durationSec: 100 }, _count: { turns: 8 } };
  m.access.mockResolvedValue({ userId: 'owner' });
  m.find.mockImplementation(async () => structuredClone(conversation));
  m.stat.mockRejectedValue(new Error('ENOENT'));
  m.fileAccess.mockResolvedValue(undefined);
  m.getJob.mockResolvedValue(null);
  m.guard.mockResolvedValue({ ok: true });
  m.quota.mockResolvedValue({ canTranscribe: true });
  m.aggregate.mockResolvedValue({ _sum: { costUsd: 0 } });
  m.updateMany.mockImplementation(async ({ where, data }) => {
    if (conversation.status !== where.status || (where.updatedAt && conversation.updatedAt.getTime() !== where.updatedAt.getTime())) return { count: 0 };
    Object.assign(conversation, data);
    return { count: 1 };
  });
  m.transcribe.mockResolvedValue({ id: 'retry-conv_1' });
  m.ingest.mockResolvedValue({ id: 'retry-conv_1' });
  m.analyze.mockResolvedValue({ id: 'retry-conv_1' });
  m.runCreate.mockResolvedValue({ id: 'new_run', status: 'pending', model: 'default-model', promptVersion: '2.0.0' });
  m.runUpdate.mockResolvedValue({});
});

describe('conversation paid retry boundaries', () => {
  it.each([401, 403, 404])('rejects %s before reading input or mutating data', async (status) => {
    m.access.mockResolvedValue({ response: NextResponse.json({ error: 'Denied' }, { status }) });
    expect((await reprocess(request(), params)).status).toBe(status);
    expect((await reextract(request('{invalid'), params)).status).toBe(status);
    expect(m.access).toHaveBeenCalledWith('conv_1', 'write');
    expect(m.find).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.runCreate).not.toHaveBeenCalled();
  });

  it('retains the old transcript and status when no media can be recovered', async () => {
    expect((await reprocess(request(), params)).status).toBe(400);
    expect(conversation.status).toBe('failed');
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.deleteTurns).not.toHaveBeenCalled();
    expect(m.deleteParticipants).not.toHaveBeenCalled();
    expect(m.ingest).not.toHaveBeenCalled();
    expect(m.transcribe).not.toHaveBeenCalled();
  });

  it('uses the configured cache for retry audio', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', '/tmp/isolated-retry');
    m.stat.mockImplementation(async (path: string) => {
      if (path === '/tmp/isolated-retry/ep_1.mp3') return { isFile: () => true, size: 12 };
      throw new Error('ENOENT');
    });
    expect((await reprocess(request(), params)).status).toBe(200);
    expect(m.stat.mock.calls.map(([path]) => path)).toEqual(['/tmp/isolated-retry/conv_1.mp3', '/tmp/isolated-retry/ep_1.mp3']);
    expect(m.transcribe).toHaveBeenCalledWith('transcribe', expect.objectContaining({ audioPath: '/tmp/isolated-retry/ep_1.mp3' }), expect.anything());
  });

  it('does not recover a default-directory file in isolated retry mode', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', '/tmp/isolated-retry');
    m.stat.mockImplementation(async (path: string) => {
      if (path.startsWith('/tmp/nanosparks-audio/')) return { isFile: () => true, size: 12 };
      throw new Error('ENOENT');
    });
    expect((await reprocess(request(), params)).status).toBe(400);
    expect(m.stat.mock.calls.map(([path]) => path)).toEqual(['/tmp/isolated-retry/conv_1.mp3', '/tmp/isolated-retry/ep_1.mp3']);
    expect(m.transcribe).not.toHaveBeenCalled();
  });

  it('re-downloads a retained enclosure without deleting existing output', async () => {
    conversation.globalEpisode.audioUrl = 'https://cdn.example.com/audio.mp3';
    expect((await reprocess(request(), params)).status).toBe(200);
    expect(m.ingest).toHaveBeenCalledWith('ingest', expect.objectContaining({ audioUrl: conversation.globalEpisode.audioUrl, title: 'Original title' }), { jobId: expect.stringMatching(/^retry-conv_1-\d+$/) });
    expect(conversation.status).toBe('pending');
    expect(m.deleteTurns).not.toHaveBeenCalled();
    expect(m.deleteParticipants).not.toHaveBeenCalled();
  });

  it('passes the verified upload storage key explicitly to transcription', async () => {
    conversation.source.mediaAssets = [{ filePath: null, storageKey: 'retained.wav' }];
    m.storageGet.mockResolvedValue(Buffer.from('audio'));
    expect((await reprocess(request(), params)).status).toBe(200);
    expect(m.transcribe).toHaveBeenCalledWith('transcribe', { conversationId: 'conv_1', mediaKey: 'retained.wav' }, expect.any(Object));
  });

  it('verifies remote stored upload content before queuing its mediaKey', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 's3');
    conversation.source.mediaAssets = [{ filePath: null, storageKey: 'stored.wav' }];
    m.storageGet.mockResolvedValue(Buffer.from('audio'));
    expect((await reprocess(request(), params)).status).toBe(200);
    expect(m.storageGet).toHaveBeenCalledWith('stored.wav');
    expect(m.transcribe).toHaveBeenCalledWith('transcribe', { conversationId: 'conv_1', mediaKey: 'stored.wav' }, expect.any(Object));
  });

  it('restores original status when Redis rejects submission', async () => {
    conversation.status = 'completed';
    conversation.globalEpisode.audioUrl = 'https://cdn.example.com/audio.mp3';
    m.ingest.mockRejectedValue(new Error('Redis unavailable'));
    expect((await reprocess(request(), params)).status).toBe(503);
    expect(conversation.status).toBe('completed');
    expect(m.deleteTurns).not.toHaveBeenCalled();
    expect(m.deleteParticipants).not.toHaveBeenCalled();
  });

  it('admits one of two concurrent retry requests', async () => {
    conversation.globalEpisode.audioUrl = 'https://cdn.example.com/audio.mp3';
    const results = await Promise.all([reprocess(request(), params), reprocess(request(), params)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(m.ingest).toHaveBeenCalledTimes(1);
  });

  it('recognizes an accepted job when Redis loses the add response', async () => {
    conversation.globalEpisode.audioUrl = 'https://cdn.example.com/audio.mp3';
    m.ingest.mockRejectedValue(new Error('Lost acknowledgment'));
    m.getJob.mockResolvedValue({ id: 'accepted-job' });
    expect((await reprocess(request(), params)).status).toBe(200);
    expect(conversation.status).toBe('pending');
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain claim and blocks a second endpoint from duplicating paid work', async () => {
    m.analyze.mockRejectedValue(new Error('Lost acknowledgment'));
    m.getJob.mockRejectedValue(new Error('Redis unavailable'));
    const first = await reextract(request(), params);
    expect(first.status).toBe(503);
    expect((await first.json()).kind).toBe('enqueue_uncertain');
    expect(conversation.status).toBe('pending');
    expect(m.runUpdate).not.toHaveBeenCalled();
    expect((await reprocess(request(), params)).status).toBe(409);
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it('uses a new job id for a later completed retry while retaining queue history', async () => {
    expect((await reextract(request(), params)).status).toBe(200);
    const firstId = m.analyze.mock.calls[0][2].jobId;
    conversation.status = 'completed';
    expect((await reextract(request(), params)).status).toBe(200);
    expect(m.analyze.mock.calls[1][2].jobId).not.toBe(firstId);
    expect(m.analyze.mock.calls[1][2]).not.toHaveProperty('removeOnFail');
  });

  it.each(['pending', 'processing', 'transcribing', 'transcribed', 'analyzing'])('does not duplicate an existing %s pipeline', async (status) => {
    conversation.status = status;
    expect((await reprocess(request(), params)).status).toBe(409);
    expect((await reextract(request(), params)).status).toBe(409);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('enforces quota and aggregate episode cost before accepting another paid run', async () => {
    m.quota.mockResolvedValue({ canTranscribe: false });
    expect((await reextract(request(), params)).status).toBe(429);
    m.quota.mockResolvedValue({ canTranscribe: true });
    m.aggregate.mockResolvedValue({ _sum: { costUsd: 2 } });
    expect((await reextract(request(), params)).status).toBe(429);
    expect(m.runCreate).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON or absent transcript', async () => {
    expect((await reextract(request('{invalid'), params)).status).toBe(400);
    conversation._count.turns = 0;
    expect((await reextract(request(), params)).status).toBe(400);
    expect(m.runCreate).not.toHaveBeenCalled();
  });

  it('marks only the new run failed and restores old status on analyze enqueue failure', async () => {
    conversation.status = 'completed';
    m.analyze.mockRejectedValue(new Error('Redis unavailable'));
    expect((await reextract(request(), params)).status).toBe(503);
    expect(conversation.status).toBe('completed');
    expect(m.runUpdate).toHaveBeenCalledWith({ where: { id: 'new_run' }, data: { status: 'failed', finishedAt: expect.any(Date) } });
    expect(m.deleteTurns).not.toHaveBeenCalled();
    expect(m.deleteParticipants).not.toHaveBeenCalled();
  });

  it('keeps existing extraction active while creating and queuing the replacement run', async () => {
    expect((await reextract(request(), params)).status).toBe(200);
    expect(m.analyze).toHaveBeenCalledWith('analyze', { conversationId: 'conv_1', extractionRunId: 'new_run' }, expect.any(Object));
    expect(m.runUpdate).not.toHaveBeenCalled();
    expect(m.runCreate.mock.calls[0][0].data.isActive).toBeUndefined();
  });
});
