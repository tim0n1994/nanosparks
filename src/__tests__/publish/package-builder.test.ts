import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPublishPackages, DEFAULT_MATRIX } from '@/lib/publish/package-builder';

const { prismaMock, clientMock } = vi.hoisted(() => ({
  prismaMock: {
    publishPackage: { upsert: vi.fn() },
  },
  clientMock: { completeWithRetry: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const input = {
  conversationId: 'conv_1',
  userId: 'user_A',
  episodeTitle: '测试集',
  showTitle: '测试节目',
  episodeNumber: '1',
  quotes: [{ id: 'q1', text: '金句一' }],
  keyPoints: [{ id: 'k1', text: '要点一' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.publishPackage.upsert.mockImplementation((args: { create: { platform: string; variant: string } }) =>
    Promise.resolve({ id: `pkg_${args.create.platform}_${args.create.variant}` }),
  );
});

describe('DEFAULT_MATRIX', () => {
  it('covers the 一鱼多吃 set: wechat + 3 xiaohongshu + zhihu', () => {
    const platforms = DEFAULT_MATRIX.map((m) => m.platform);
    expect(platforms.filter((p) => p === 'xiaohongshu')).toHaveLength(3);
    expect(platforms).toContain('wechat');
    expect(platforms).toContain('zhihu');
  });
});

describe('buildPublishPackages', () => {
  it('persists one package per matrix entry and returns them', async () => {
    clientMock.completeWithRetry.mockResolvedValue({
      content: '{"title":"t","body":"b"}',
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const out = await buildPublishPackages(input, clientMock as never);

    expect(out).toHaveLength(DEFAULT_MATRIX.length);
    expect(prismaMock.publishPackage.upsert).toHaveBeenCalledTimes(DEFAULT_MATRIX.length);
    expect(out[0].id).toMatch(/^pkg_/);
  });

  it('records sensitive-word hits in the package', async () => {
    clientMock.completeWithRetry.mockResolvedValue({
      content: '{"title":"最好的产品","body":"加微信详聊"}',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const out = await buildPublishPackages(input, clientMock as never, [
      { platform: 'xiaohongshu', variant: 'list' },
    ]);

    expect(out[0].sensitiveHits).toBeGreaterThanOrEqual(2); // 最好 + 加微信
  });

  it('estimates cost from token usage', async () => {
    clientMock.completeWithRetry.mockResolvedValue({
      content: '{"title":"t","body":"b"}',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });

    const out = await buildPublishPackages(input, clientMock as never, [
      { platform: 'zhihu', variant: 'digest' },
    ]);

    // ~$0.14 in + ~$0.28 out = ~$0.42
    expect(out[0].costUsd).toBeGreaterThan(0.4);
    expect(out[0].costUsd).toBeLessThan(0.45);
  });

  it('persists an error package when the LLM fails (does not throw)', async () => {
    clientMock.completeWithRetry.mockRejectedValue(new Error('model down'));

    const out = await buildPublishPackages(input, clientMock as never, [
      { platform: 'wechat', variant: 'digest' },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].copyText).toContain('generation_failed');
  });
});
