import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    thoughtUnit: { count: vi.fn() },
  },
  transcribe: { getJobs: vi.fn(), getJobCounts: vi.fn(), close: vi.fn(), add: vi.fn() },
  analyze: { getJobs: vi.fn() },
  exists: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/queue/config', () => ({ transcribeQueue: mocks.transcribe, analyzeQueue: mocks.analyze }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists }));

import { watchdogTick } from '@/lib/queue/pipeline-watchdog';

const stale = (id: string) => ({
  id, episodeId: null, updatedAt: new Date('2026-01-01'), _count: { turns: 0, participants: 0 },
});

describe('watchdog recovery safety', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prisma.conversation.findMany.mockResolvedValue([]);
    mocks.prisma.conversation.findUnique.mockResolvedValue(null);
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    mocks.transcribe.getJobs.mockResolvedValue([]);
    mocks.analyze.getJobs.mockResolvedValue([]);
    mocks.transcribe.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0 });
    mocks.transcribe.add.mockResolvedValue({ id: 'recovery' });
    mocks.exists.mockReturnValue(true);
  });

  function candidates(transcribing = [stale('t')], analyzing: ReturnType<typeof stale>[] = []) {
    mocks.prisma.conversation.findMany.mockImplementation(({ where }) => Promise.resolve(
      where.status === 'transcribing' ? transcribing : analyzing,
    ));
  }

  it('searches both conversation and video filenames only inside the configured audio directory', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', '/tmp/watchdog-isolated-audio');
    candidates();
    mocks.prisma.conversation.findUnique.mockResolvedValue({ episodeKey: 'youtube:abcdefghijk' });
    mocks.exists.mockImplementation((path: string) => path === '/tmp/watchdog-isolated-audio/abcdefghijk.mp3');
    const result = await watchdogTick();
    expect(result.requeued).toBe(1);
    expect(mocks.exists.mock.calls.map(([path]) => path)).toEqual([
      '/tmp/watchdog-isolated-audio/t.m4a', '/tmp/watchdog-isolated-audio/t.mp3',
      '/tmp/watchdog-isolated-audio/t.wav', '/tmp/watchdog-isolated-audio/t.webm',
      '/tmp/watchdog-isolated-audio/abcdefghijk.m4a', '/tmp/watchdog-isolated-audio/abcdefghijk.mp3',
    ]);
    expect(mocks.transcribe.add).toHaveBeenCalledWith('transcribe', expect.objectContaining({
      audioPath: '/tmp/watchdog-isolated-audio/abcdefghijk.mp3',
    }), expect.any(Object));
  });

  it('does not reuse a default-cache file when the isolated audio directory is empty', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', '/tmp/watchdog-isolated-audio');
    candidates();
    mocks.exists.mockImplementation((path: string) => path.startsWith('/tmp/nanosparks-audio/'));
    const result = await watchdogTick();
    expect(result.requeued).toBe(0);
    expect(result.reset).toBe(1);
    expect(mocks.exists.mock.calls.map(([path]) => path)).toEqual([
      '/tmp/watchdog-isolated-audio/t.m4a', '/tmp/watchdog-isolated-audio/t.mp3',
      '/tmp/watchdog-isolated-audio/t.wav', '/tmp/watchdog-isolated-audio/t.webm',
    ]);
    expect(mocks.transcribe.add).not.toHaveBeenCalled();
  });

  it('never closes the shared queue and leaves enqueue failures recoverable', async () => {
    candidates();
    mocks.transcribe.add.mockRejectedValue(new Error('Redis disconnected'));
    await watchdogTick();
    await watchdogTick();
    expect(mocks.transcribe.close).not.toHaveBeenCalled();
    expect(mocks.transcribe.add).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.conversation.update).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('checks analysis without any stuck transcription and never infers completion from TUs', async () => {
    candidates([], [stale('a')]);
    mocks.prisma.thoughtUnit.count.mockResolvedValue(10);
    const result = await watchdogTick();
    expect(result.checked).toBe(1);
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'a', status: 'analyzing' }), data: { status: 'failed' },
    }));
    expect(mocks.prisma.thoughtUnit.count).not.toHaveBeenCalled();
  });

  it('does not treat unavailable queue state as idle', async () => {
    candidates();
    mocks.transcribe.getJobs.mockRejectedValue(new Error('Redis disconnected'));
    mocks.transcribe.getJobCounts.mockRejectedValue(new Error('Redis disconnected'));
    await watchdogTick();
    expect(mocks.transcribe.add).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('does not recover an active conversation, but unrelated queue work does not mask an orphan', async () => {
    candidates([stale('active'), stale('orphan')]);
    mocks.transcribe.getJobs.mockImplementation(async (states: string[]) => states.includes('active')
      ? [{ data: { conversationId: 'active' } }] : []);
    await watchdogTick();
    expect(mocks.transcribe.add).toHaveBeenCalledTimes(1);
    expect(mocks.transcribe.add).toHaveBeenCalledWith('transcribe', expect.objectContaining({ conversationId: 'orphan' }), expect.any(Object));
  });

  it('preserves partial transcription and marks it failed instead of replacing evidence', async () => {
    candidates([{ ...stale('partial'), _count: { turns: 3, participants: 1 } }]);
    await watchdogTick();
    expect(mocks.transcribe.add).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'failed' } }));
  });

  it('does not restart a job that exhausted its bounded attempts', async () => {
    candidates();
    mocks.transcribe.getJobs.mockImplementation(async (states: string[]) => states.includes('failed')
      ? [{ data: { conversationId: 't' }, finishedOn: new Date('2026-01-02').getTime() }] : []);
    await watchdogTick();
    expect(mocks.transcribe.add).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalled();
  });

  it('coalesces overlapping ticks and uses a deterministic recovery job ID', async () => {
    candidates();
    await Promise.all([watchdogTick(), watchdogTick()]);
    expect(mocks.transcribe.add).toHaveBeenCalledTimes(1);
    expect(mocks.transcribe.add).toHaveBeenCalledWith('transcribe', expect.any(Object), {
      jobId: `watchdog-t-${new Date('2026-01-01').getTime()}`,
    });
  });

  it('bounds an offline queue check and still checks the independent analysis stage', async () => {
    vi.useFakeTimers();
    candidates([stale('t')], [stale('a')]);
    mocks.transcribe.getJobs.mockReturnValue(new Promise(() => {}));
    const tick = watchdogTick();
    await vi.advanceTimersByTimeAsync(5001);
    await tick;
    expect(mocks.transcribe.add).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'a' }),
    }));
  });

  it('leaves live analysis alone even when transcription is idle', async () => {
    candidates([], [stale('a')]);
    mocks.analyze.getJobs.mockImplementation(async (states: string[]) => states.includes('active')
      ? [{ data: { conversationId: 'a' } }] : []);
    await watchdogTick();
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });
});
