/**
 * Tests for pipeline-watchdog — the in-process self-healing guard.
 *
 * Scenarios:
 *   1. No stuck conversations → no action
 *   2. Stuck + ASR busy → wait (don't interrupt)
 *   3. Stuck + no matching job + audio exists → requeue
 *   4. Stuck + ASR idle + no audio → mark failed
 *
 * Queue ownership is checked per conversation. Audio lookup also resolves
 * YouTube video IDs; partial output is preserved for explicit retry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  conversation: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  thoughtUnit: { count: vi.fn() },
}));
const queueMock = vi.hoisted(() => ({
  transcribeQueue: {
    add: vi.fn(async () => ({ id: 'job_x' })),
    getJobCounts: vi.fn(),
    getJobs: vi.fn(),
    close: vi.fn(),
  },
  analyzeQueue: { getJobs: vi.fn() },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/queue/config', () => queueMock);
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

// Mock fs.existsSync — controllable per-test via this flag.
let mockAudioExists = false;
vi.mock('node:fs', () => ({ existsSync: () => mockAudioExists }));

import { watchdogTick } from '@/lib/queue/pipeline-watchdog';

function mockQueueDepth(busy: boolean) {
  queueMock.transcribeQueue.getJobs.mockImplementation(async (states: string[]) =>
    busy && states.includes('active') ? [{ data: { conversationId: 'conv-stuck-1' } }] : []);
}

describe('watchdogTick', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAudioExists = false;
    prismaMock.conversation.findMany.mockImplementation((args) => {
      const status = (args as { where?: { status?: string } })?.where?.status;
      return Promise.resolve(status === 'transcribing' ? stuckConvs.map((conv) => ({
        ...conv, episodeId: null, updatedAt: new Date('2026-01-01'), _count: { turns: 0, participants: 0 },
      })) : []);
    });
    prismaMock.thoughtUnit.count.mockResolvedValue(0);
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 1 });
    queueMock.transcribeQueue.getJobs.mockResolvedValue([]);
    queueMock.analyzeQueue.getJobs.mockResolvedValue([]);
    stuckConvs.length = 0;
  });

  // Mutated per-test to control which stuck conversations the watchdog sees.
  const stuckConvs: Array<{ id: string }> = [];

  it('no stuck conversations → no action', async () => {
    mockQueueDepth(false);

    const result = await watchdogTick();

    expect(result.checked).toBe(0);
    expect(result.requeued).toBe(0);
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    expect(queueMock.transcribeQueue.add).not.toHaveBeenCalled();
  });

  it('stuck + ASR busy → waits without acting', async () => {
    stuckConvs.push({ id: 'conv-stuck-1' });
    mockQueueDepth(true); // transcribe queue has work → busy

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(0);
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it('stuck + ASR idle + audio exists → requeue without losing recoverable state', async () => {
    stuckConvs.push({ id: 'conv-stuck-1' });
    mockQueueDepth(false); // queue empty → idle
    mockAudioExists = true;
    prismaMock.conversation.update.mockResolvedValue({});

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(1);
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    expect(queueMock.transcribeQueue.add).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({ conversationId: 'conv-stuck-1' }),
      expect.objectContaining({ jobId: expect.stringContaining('watchdog-conv-stuck-1-') }),
    );
  });

  it('stuck + ASR idle + no audio → mark failed', async () => {
    stuckConvs.push({ id: 'conv-stuck-2' });
    mockQueueDepth(false);
    prismaMock.conversation.update.mockResolvedValue({});

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(0);
    expect(result.reset).toBe(1);
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'conv-stuck-2' }), data: { status: 'failed' } }),
    );
    expect(queueMock.transcribeQueue.add).not.toHaveBeenCalled();
  });

  it('queue check unreachable → preserves state for another check', async () => {
    mockQueueDepth(false);
    stuckConvs.push({ id: 'conv-stuck-1' });
    queueMock.transcribeQueue.getJobs.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(queueMock.transcribeQueue.add).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
  });
});
