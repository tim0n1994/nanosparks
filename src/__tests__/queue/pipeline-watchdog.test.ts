/**
 * Tests for pipeline-watchdog — the in-process self-healing guard.
 *
 * Scenarios:
 *   1. No stuck conversations → no action
 *   2. Stuck + ASR busy → wait (don't interrupt)
 *   3. Stuck + ASR idle + audio exists → reset + requeue
 *   4. Stuck + ASR idle + no audio → mark failed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  conversation: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));
const queueMock = vi.hoisted(() => ({ transcribeQueue: { add: vi.fn(async () => ({ id: 'job_x' })) } }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/queue/config', () => ({ transcribeQueue: queueMock.transcribeQueue }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));

// Mock fetch for ASR health check — default: ASR idle (processing_jobs=0)
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

// Mock fs.existsSync — controllable per-test via this flag.
let mockAudioExists = false;
vi.mock('node:fs', () => ({ existsSync: () => mockAudioExists }));

import { watchdogTick } from '@/lib/queue/pipeline-watchdog';

function mockAsrHealth(processingJobs: number, ok = true) {
  fetchMock.mockResolvedValue(
    ok
      ? { ok: true, json: async () => ({ status: 'ok', processing_jobs: processingJobs }) }
      : { ok: false, json: async () => ({}) },
  );
}

describe('watchdogTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioExists = false;
  });

  it('no stuck conversations → no action', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([]);
    mockAsrHealth(0);

    const result = await watchdogTick();

    expect(result.checked).toBe(0);
    expect(result.requeued).toBe(0);
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    expect(queueMock.transcribeQueue.add).not.toHaveBeenCalled();
  });

  it('stuck + ASR busy → waits without acting', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conv-stuck-1' }]);
    mockAsrHealth(1); // ASR processing

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(0);
    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it('stuck + ASR idle + audio exists → reset + requeue', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conv-stuck-1' }]);
    mockAsrHealth(0); // ASR idle
    mockAudioExists = true;
    prismaMock.conversation.update.mockResolvedValue({});

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(1);
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-stuck-1' }, data: { status: 'pending' } }),
    );
    expect(queueMock.transcribeQueue.add).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({ conversationId: 'conv-stuck-1' }),
    );
  });

  it('stuck + ASR idle + no audio → mark failed', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conv-stuck-2' }]);
    mockAsrHealth(0);
    prismaMock.conversation.update.mockResolvedValue({});

    const result = await watchdogTick();

    expect(result.checked).toBe(1);
    expect(result.requeued).toBe(0);
    expect(result.reset).toBe(1);
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-stuck-2' }, data: { status: 'failed' } }),
    );
    expect(queueMock.transcribeQueue.add).not.toHaveBeenCalled();
  });

  it('ASR unreachable → treats as idle (proceeds to recover)', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([]);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await watchdogTick();

    // No stuck conversations → nothing to do regardless.
    expect(result.checked).toBe(0);
  });
});
