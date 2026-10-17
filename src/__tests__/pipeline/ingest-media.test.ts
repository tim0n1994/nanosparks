import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    episode: { update: vi.fn() },
    mediaAsset: { upsert: vi.fn() },
  },
  download: vi.fn(), youtubeDownload: vi.fn(), videoDownload: vi.fn(), flow: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/queue/flow', () => ({ addProcessingFlow: mocks.flow }));
vi.mock('@/lib/youtube/downloader', () => ({ downloadAudioFromUrl: mocks.download }));
vi.mock('@/lib/youtube/ytdlp', () => ({ downloadAudio: mocks.youtubeDownload, downloadAudioFromUrl: mocks.videoDownload }));
vi.mock('@/lib/xiaoyuzhou/client', () => ({ getEpisode: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { processIngestJob } from '@/lib/queue/jobs/ingest';

const payload = {
  conversationId: 'conv-1', episodeKey: 'direct:track-1', platform: 'direct' as const,
  audioUrl: 'https://example.test/recording.m4a', sourceUrl: 'https://example.test/recording', title: 'Recording',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.conversation.findUnique.mockResolvedValue({ sourceId: 'source-1' });
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.episode.update.mockResolvedValue({});
  mocks.download.mockResolvedValue('/tmp/nanosparks-audio/conv-1.m4a');
  mocks.videoDownload.mockResolvedValue('/tmp/nanosparks-audio/video-safe-name.mp3');
});

describe('ingest media recovery metadata', () => {
  it('passes the claimed retry run ID into the processing flow', async () => {
    await processIngestJob({ ...payload, processingRunId: 'retry-conv-1-123456' });
    expect(mocks.flow.mock.calls[0][0].processingRunId).toBe('retry-conv-1-123456');
  });

  it('persists the actual downloaded extension before dispatching the processing flow', async () => {
    await processIngestJob(payload);
    expect(mocks.prisma.mediaAsset.upsert).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^ingest-[0-9a-f]{64}$/) },
      create: { id: expect.any(String), sourceId: 'source-1', mediaType: 'audio', filePath: '/tmp/nanosparks-audio/conv-1.m4a' },
      update: { filePath: '/tmp/nanosparks-audio/conv-1.m4a' },
    });
    expect(mocks.prisma.mediaAsset.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.flow.mock.invocationCallOrder[0]);
    expect(mocks.flow.mock.calls[0][0].mediaPath).toBe('/tmp/nanosparks-audio/conv-1.m4a');
  });

  it('uses the same asset ID on retry without accumulating duplicate media metadata', async () => {
    await processIngestJob(payload);
    await processIngestJob(payload);
    expect(mocks.prisma.mediaAsset.upsert.mock.calls[0][0].where.id).toBe(mocks.prisma.mediaAsset.upsert.mock.calls[1][0].where.id);
  });

  it('persists the generated video filename rather than assuming it matches conversationId', async () => {
    await processIngestJob({ ...payload, platform: 'bilibili' });
    expect(mocks.prisma.mediaAsset.upsert.mock.calls[0][0].create.filePath).toBe('/tmp/nanosparks-audio/video-safe-name.mp3');
  });

  it('resolves the linked source for legacy episode jobs', async () => {
    await processIngestJob({ episodeId: 'episode-1', youtubeUrl: 'https://youtu.be/abcdefghijk' });
    expect(mocks.prisma.conversation.findUnique).toHaveBeenCalledWith({ where: { episodeId: 'episode-1' }, select: { sourceId: true } });
    expect(mocks.prisma.mediaAsset.upsert.mock.calls[0][0].create.sourceId).toBe('source-1');
  });

  it('does not invent a source for old source-less conversations', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValueOnce({ sourceId: null });
    await processIngestJob(payload);
    expect(mocks.prisma.mediaAsset.upsert).not.toHaveBeenCalled();
    expect(mocks.flow).toHaveBeenCalledOnce();
  });

  it('marks ingest failed and avoids dispatch when media metadata persistence fails', async () => {
    mocks.prisma.mediaAsset.upsert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(processIngestJob(payload)).rejects.toThrow('database unavailable');
    expect(mocks.flow).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.update).toHaveBeenLastCalledWith({ where: { id: 'conv-1' }, data: { status: 'failed' } });
  });
});
