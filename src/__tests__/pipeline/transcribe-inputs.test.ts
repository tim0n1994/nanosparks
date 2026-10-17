import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    episode: { update: vi.fn() },
    source: { update: vi.fn() },
    participant: { create: vi.fn(), deleteMany: vi.fn() },
    turn: { createMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  asr: vi.fn(), whisper: vi.fn(), storageGet: vi.fn(), download: vi.fn(),
  analyze: vi.fn(), redact: vi.fn(), status: vi.fn(), factory: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/queue/config', () => ({ addAnalyzeJob: mocks.analyze }));
vi.mock('@/lib/transcription/factory', () => ({ createTranscriptionProvider: mocks.factory, isChineseSource: () => false }));
vi.mock('@/lib/transcription/whisper', () => ({ transcribeAudio: mocks.whisper }));
vi.mock('@/lib/storage/provider', () => ({ createStorageProvider: () => ({ get: mocks.storageGet }) }));
vi.mock('@/lib/youtube/downloader', () => ({ downloadAudio: mocks.download }));
vi.mock('@/lib/adapters/episode-to-conversation', () => ({ updateConversationStatus: mocks.status }));
vi.mock('@/lib/pii', () => ({ redactPii: mocks.redact }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const trackedStat = (...args: Parameters<typeof actual.stat>) => { mocks.stat(args[0]); return actual.stat(...args); };
  return { ...actual, default: { ...actual, stat: trackedStat }, stat: trackedStat };
});

import { processTranscribeJob } from '@/lib/queue/jobs/transcribe';

let directory: string;
let audioPath: string;
let oldState: { turns: string[]; participants: string[]; evidenceTurnId: string | null };
const result = {
  language: 'en', provider: 'mock',
  segments: [{ startMs: 0, endMs: 1000, text: 'new transcript', speakerLabel: 'speaker-1', confidence: 0.9 }],
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'transcribe-input-test-'));
  audioPath = join(directory, 'input.mp3');
  await writeFile(audioPath, 'audio bytes');
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  oldState = { turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' };
  mocks.prisma.conversation.findUnique.mockResolvedValue({ title: 'English title', sourceId: 'source-1', source: { mediaAssets: [] } });
  mocks.prisma.conversation.findFirst.mockResolvedValue(null);
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.source.update.mockResolvedValue({});
  mocks.prisma.episode.update.mockResolvedValue({});
  mocks.prisma.turn.deleteMany.mockImplementation(async () => { oldState.turns = []; oldState.evidenceTurnId = null; });
  mocks.prisma.participant.deleteMany.mockImplementation(async () => { oldState.participants = []; });
  mocks.prisma.participant.create.mockImplementation(async () => { oldState.participants.push('new-participant'); return { id: 'new-participant' }; });
  mocks.prisma.turn.createMany.mockImplementation(async () => { oldState.turns.push('new-turn'); });
  mocks.prisma.$transaction.mockImplementation(async (callback) => {
    const original = structuredClone(oldState);
    try { return await callback(mocks.prisma); }
    catch (error) { oldState = original; throw error; }
  });
  mocks.factory.mockReturnValue({ transcribe: mocks.asr });
  mocks.asr.mockResolvedValue(result);
  mocks.whisper.mockResolvedValue([{ start: 0, end: 1, text: 'legacy transcript' }]);
  mocks.redact.mockResolvedValue({ redactedText: 'redacted transcript' });
  mocks.storageGet.mockResolvedValue(Buffer.from('stored audio'));
  mocks.download.mockResolvedValue(audioPath);
  mocks.status.mockResolvedValue(undefined);
});

describe('transcribe media input and replacement contract', () => {
  it('searches legacy filenames only inside the configured audio directory', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', directory);
    const fallbackPath = join(directory, 'isolated-conv.mp3');
    await writeFile(fallbackPath, 'isolated audio');
    await processTranscribeJob({ conversationId: 'isolated-conv', step: 'transcribe' });
    expect(mocks.asr.mock.calls[0][0].mediaPath).toBe(fallbackPath);
    expect(mocks.stat.mock.calls.map(([path]) => path)).toEqual([fallbackPath]);
  });

  it('does not probe the default cache when isolated fallback files are absent', async () => {
    vi.stubEnv('NSP_AUDIO_DIR', directory);
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      source: { mediaAssets: [] }, globalEpisode: { platformId: 'missing-video' },
    });
    await expect(processTranscribeJob({ conversationId: 'isolated-missing' })).rejects.toThrow('No audio file found');
    expect(mocks.stat.mock.calls.map(([path]) => path)).toEqual([
      join(directory, 'isolated-missing.mp3'), join(directory, 'missing-video.mp3'),
    ]);
    expect(mocks.asr).not.toHaveBeenCalled();
  });

  it('consumes the FlowProducer mediaPath even when episodeId is present as undefined', async () => {
    await processTranscribeJob({ conversationId: 'conv-1', episodeId: undefined, mediaPath: audioPath, step: 'transcribe', asrProvider: 'deepgram' });
    expect(mocks.asr).toHaveBeenCalledWith({ mediaPath: audioPath, mimeType: undefined, language: 'en' });
    expect(mocks.factory).toHaveBeenCalledWith({ override: 'deepgram' });
    expect(mocks.storageGet).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.turn.createMany.mock.calls[0][0].data[0]).toMatchObject({ text: 'new transcript', cleanText: 'redacted transcript', participantId: 'new-participant' });
  });

  it('prioritizes a valid audioPath over mediaPath and mediaKey', async () => {
    await processTranscribeJob({ conversationId: 'conv-1', audioPath, mediaPath: '/missing.mp3', mediaKey: 'unused.mp3' });
    expect(mocks.asr.mock.calls[0][0].mediaPath).toBe(audioPath);
    expect(mocks.storageGet).not.toHaveBeenCalled();
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith({ conversationId: 'conv-1', sourceId: 'source-1' });
  });

  it('reads nested upload keys through storage and cleans its isolated temporary file', async () => {
    let materializedPath = '';
    mocks.asr.mockImplementationOnce(async ({ mediaPath }) => {
      materializedPath = mediaPath;
      expect(await readFile(mediaPath, 'utf8')).toBe('stored audio');
      return result;
    });
    await processTranscribeJob({ conversationId: 'conv-1', sourceId: 'source-1', mediaKey: 'uploads/nested/audio.mp3', mimeType: 'audio/mpeg' });
    expect(mocks.storageGet).toHaveBeenCalledExactlyOnceWith('uploads/nested/audio.mp3');
    expect(materializedPath).toMatch(/nanosparks-transcribe-.*\/media.mp3$/);
    await expect(stat(materializedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a missing explicit path from a persistent storage key', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ source: { mediaAssets: [{ filePath: '/gone.mp3', storageKey: 'durable.mp3' }] } });
    await processTranscribeJob({ conversationId: 'conv-1', mediaPath: '/gone.mp3', step: 'transcribe' });
    expect(mocks.storageGet).toHaveBeenCalledWith('durable.mp3');
  });

  it('checks all persistent media file paths instead of only the first asset', async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ source: { mediaAssets: [{ filePath: '/gone.mp3' }, { filePath: audioPath }] } });
    await processTranscribeJob({ conversationId: 'conv-1', step: 'transcribe' });
    expect(mocks.asr.mock.calls[0][0].mediaPath).toBe(audioPath);
  });

  it('retains legacy youtube downloading and enqueues analysis once', async () => {
    await processTranscribeJob({ episodeId: 'episode-1', youtubeUrl: 'https://youtu.be/abcdefghijk' });
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith('abcdefghijk');
    expect(mocks.whisper).toHaveBeenCalledExactlyOnceWith(audioPath);
    expect(mocks.analyze).toHaveBeenCalledExactlyOnceWith({ episodeId: 'episode-1' });
  });

  it('supports legacy episode flows containing mediaPath without downloading again', async () => {
    await processTranscribeJob({ episodeId: 'episode-1', mediaPath: audioPath, youtubeUrl: 'https://youtu.be/abcdefghijk', step: 'transcribe' });
    expect(mocks.whisper).toHaveBeenCalledWith(audioPath);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('reports missing media without deleting old turns or participants', async () => {
    await expect(processTranscribeJob({ conversationId: 'missing-conv' })).rejects.toThrow('No audio file found');
    expect(mocks.asr).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(oldState).toEqual({ turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' });
    expect(mocks.prisma.conversation.update).toHaveBeenLastCalledWith({ where: { id: 'missing-conv' }, data: { status: 'failed' } });
  });

  it('preserves existing evidence on ASR failure and cleans uploaded media', async () => {
    let materializedPath = '';
    mocks.asr.mockImplementationOnce(async ({ mediaPath }) => { materializedPath = mediaPath; throw new Error('ASR unavailable'); });
    await expect(processTranscribeJob({ conversationId: 'conv-1', mediaKey: 'upload.mp3' })).rejects.toThrow('ASR unavailable');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(oldState.evidenceTurnId).toBe('old-turn');
    expect(oldState.turns).toEqual(['old-turn']);
    expect(oldState.participants).toEqual(['old-participant']);
    expect(mocks.analyze).not.toHaveBeenCalled();
    await expect(stat(materializedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not erase the transcript when ASR returns no segments', async () => {
    mocks.asr.mockResolvedValueOnce({ ...result, segments: [] });
    await expect(processTranscribeJob({ conversationId: 'conv-1', audioPath })).rejects.toThrow('no segments');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(oldState.turns).toEqual(['old-turn']);
  });

  it('preserves old turns, participants and evidence when ASR returns only whitespace', async () => {
    mocks.asr.mockResolvedValueOnce({ ...result, segments: [{ ...result.segments[0], text: ' \n\t ' }] });
    await expect(processTranscribeJob({ conversationId: 'conv-1', audioPath })).rejects.toThrow('no segments with text');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(oldState).toEqual({ turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' });
  });

  it('drops blank ASR segments while keeping the remaining transcript', async () => {
    mocks.asr.mockResolvedValueOnce({ ...result, segments: [{ ...result.segments[0], text: '  ' }, result.segments[0]] });
    await processTranscribeJob({ conversationId: 'conv-1', audioPath });
    expect(mocks.prisma.turn.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(mocks.prisma.turn.createMany.mock.calls[0][0].data[0]).toMatchObject({ text: 'new transcript', turnIndex: 0 });
  });

  it('preserves the legacy transcript when Whisper returns only whitespace', async () => {
    mocks.whisper.mockResolvedValueOnce([{ start: 0, end: 1, text: '\n\t ' }]);
    await expect(processTranscribeJob({ episodeId: 'episode-1', audioPath })).rejects.toThrow('no segments with text');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(oldState).toEqual({ turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' });
  });

  it('rolls back transcript, participants and evidence if replacement fails midway', async () => {
    mocks.prisma.turn.createMany.mockRejectedValueOnce(new Error('write rejected'));
    await expect(processTranscribeJob({ conversationId: 'conv-1', audioPath })).rejects.toThrow('write rejected');
    expect(mocks.prisma.turn.deleteMany).toHaveBeenCalledOnce();
    expect(oldState).toEqual({ turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('replaces participants on each successful retry instead of accumulating speakers', async () => {
    await processTranscribeJob({ conversationId: 'conv-1', audioPath, step: 'transcribe' });
    await processTranscribeJob({ conversationId: 'conv-1', audioPath, step: 'transcribe' });
    expect(oldState.participants).toEqual(['new-participant']);
    expect(oldState.turns).toEqual(['new-turn']);
    expect(oldState.evidenceTurnId).toBeNull();
  });

  it.each(['conversation', 'legacy'])('atomically stores a long %s transcript beyond the default transaction budget', async (path) => {
    const segments = Array.from({ length: 19_818 }, (_, index) => ({
      ...result.segments[0], startMs: index * 200, endMs: (index + 1) * 200, text: `word ${index}`,
    }));
    mocks.asr.mockResolvedValueOnce({ ...result, segments });
    mocks.whisper.mockResolvedValueOnce(segments.map((seg) => ({ start: seg.startMs / 1000, end: seg.endMs / 1000, text: seg.text })));
    mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    let elapsedMs = 0;
    let timeoutMs = 5000;
    let inTransaction = false;
    mocks.prisma.$transaction.mockImplementation(async (callback, options?: { timeout?: number }) => {
      const original = structuredClone(oldState);
      timeoutMs = options?.timeout ?? 5000;
      inTransaction = true;
      try { return await callback(mocks.prisma); }
      catch (error) { oldState = original; throw error; }
      finally { inTransaction = false; }
    });
    mocks.prisma.turn.createMany.mockImplementation(async ({ data }: { data: Array<{ turnIndex: number }> }) => {
      elapsedMs += data.length * 0.42;
      oldState.turns.push(...data.map((turn) => `new-turn-${turn.turnIndex}`));
    });
    mocks.prisma.conversation.update.mockImplementation(async () => {
      if (inTransaction && elapsedMs > timeoutMs) throw new Error('Transaction expired before the final status update');
      return {};
    });

    await processTranscribeJob({ ...(path === 'conversation' ? { conversationId: 'conv-1' } : { episodeId: 'episode-1' }), audioPath, step: 'transcribe' });

    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(timeoutMs).toBeGreaterThan(elapsedMs);
    expect(timeoutMs).toBeLessThanOrEqual(120_000);
    const batches = mocks.prisma.turn.createMany.mock.calls.map(([args]) => args.data as Array<{ turnIndex: number }>);
    expect(Math.max(...batches.map((batch) => batch.length))).toBeLessThanOrEqual(1000);
    expect(batches.flat().map((turn) => turn.turnIndex)).toEqual(segments.map((_, index) => index));
    expect(oldState.turns).toHaveLength(19_818);
    expect(mocks.prisma.conversation.update).toHaveBeenLastCalledWith({ where: { id: 'conv-1' }, data: expect.objectContaining({ status: 'transcribed' }) });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('rolls back every batch when a later long-transcript write fails', async () => {
    mocks.asr.mockResolvedValueOnce({ ...result, segments: Array.from({ length: 2500 }, () => result.segments[0]) });
    let writes = 0;
    mocks.prisma.turn.createMany.mockImplementation(async () => {
      if (++writes === 2) throw new Error('second batch rejected');
      oldState.turns.push('uncommitted-batch');
    });
    await expect(processTranscribeJob({ conversationId: 'conv-1', audioPath })).rejects.toThrow('second batch rejected');
    expect(writes).toBe(2);
    expect(oldState).toEqual({ turns: ['old-turn'], participants: ['old-participant'], evidenceTurnId: 'old-turn' });
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.update).toHaveBeenLastCalledWith({ where: { id: 'conv-1' }, data: { status: 'failed' } });
  });
});
