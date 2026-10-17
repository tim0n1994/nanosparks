import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('child_process', () => ({ default: { execFile: mocks.execFile }, execFile: mocks.execFile }));
vi.mock('node:fs', () => ({ default: {
  existsSync: mocks.existsSync, mkdirSync: mocks.mkdirSync, writeFileSync: mocks.writeFileSync,
}, existsSync: mocks.existsSync, mkdirSync: mocks.mkdirSync, writeFileSync: mocks.writeFileSync }));
vi.mock('fs', () => ({ default: {
  existsSync: mocks.existsSync, mkdirSync: mocks.mkdirSync, writeFileSync: mocks.writeFileSync,
}, existsSync: mocks.existsSync, mkdirSync: mocks.mkdirSync, writeFileSync: mocks.writeFileSync }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { downloadAudio, downloadAudioFromUrl, getVideoMeta } from '@/lib/youtube/ytdlp';
import { downloadAudio as legacyDownload, downloadAudioFromUrl as directDownload } from '@/lib/youtube/downloader';

const videoId = 'abcdefghijk';
const customDir = '/tmp/nanosparks-download-isolation-test';
type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NSP_AUDIO_DIR', customDir);
  vi.stubEnv('NSP_YTDLP_COOKIES_FROM_BROWSER', 'none');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.existsSync.mockReturnValue(false);
  mocks.execFile.mockImplementation((_cmd: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(null, '', '');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isolated yt-dlp downloads', () => {
  it.each([
    ['YouTube', () => downloadAudio(videoId), `${videoId}.mp3`],
    ['generic URL', () => downloadAudioFromUrl('https://example.test/watch/episode', 'episode'), 'episode.mp3'],
  ] as const)('%s checks and writes only the configured output directory', async (_label, download, filename) => {
    const output = `${customDir}/${filename}`;
    expect(await download()).toBe(output);
    expect(mocks.existsSync.mock.calls.map(([pathname]) => pathname)).toEqual([customDir, output]);
    expect(mocks.mkdirSync).toHaveBeenCalledWith(customDir, { recursive: true });
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    const args = mocks.execFile.mock.calls[0][1];
    expect(args).toContain('--ignore-config');
    expect(args).not.toContain('--cookies-from-browser');
    expect(args[args.indexOf('-o') + 1]).toBe(output);
  });

  it('reuses a cached file only from the configured directory', async () => {
    mocks.existsSync.mockImplementation((pathname: string) => pathname === `${customDir}/${videoId}.mp3`);
    expect(await downloadAudio(videoId)).toBe(`${customDir}/${videoId}.mp3`);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.existsSync).not.toHaveBeenCalledWith(`/tmp/nanosparks-audio/${videoId}.mp3`);
  });

  it.each([
    ['YouTube', () => downloadAudio(videoId)],
    ['generic URL', () => downloadAudioFromUrl('https://example.test/episode', 'episode')],
  ] as const)('%s does not retry the same anonymous command when cookies are disabled', async (_label, download) => {
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('offline'), '', 'offline');
    });
    await expect(download()).rejects.toThrow('offline');
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0][1]).not.toContain('--cookies-from-browser');
  });

  it.each([
    ['YouTube', () => downloadAudio(videoId)],
    ['generic URL', () => downloadAudioFromUrl('https://example.test/episode', 'episode')],
  ] as const)('%s preserves the default Chrome-first anonymous fallback', async (_label, download) => {
    vi.stubEnv('NSP_YTDLP_COOKIES_FROM_BROWSER', undefined);
    vi.stubEnv('NSP_AUDIO_DIR', undefined);
    mocks.execFile.mockImplementationOnce((_cmd: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('Chrome unavailable'), '', 'Chrome unavailable');
    });
    expect(await download()).toMatch(/^\/tmp\/nanosparks-audio\//);
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    const firstArgs = mocks.execFile.mock.calls[0][1];
    const fallbackArgs = mocks.execFile.mock.calls[1][1];
    expect(firstArgs.slice(0, 2)).toEqual(['--cookies-from-browser', 'chrome']);
    expect(fallbackArgs).not.toContain('--cookies-from-browser');
    expect(fallbackArgs).not.toContain('--ignore-config');
    expect(firstArgs.slice(2)).toEqual(fallbackArgs);
  });

  it('rejects an unknown cookie preference before spawning yt-dlp', async () => {
    vi.stubEnv('NSP_YTDLP_COOKIES_FROM_BROWSER', 'unexpected');
    await expect(downloadAudio(videoId)).rejects.toThrow('must be chrome or none');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('ignores local configuration in metadata fallback when cookies are disabled', async () => {
    mocks.fetch.mockRejectedValue(new Error('offline'));
    mocks.execFile.mockImplementation((_cmd: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(null, JSON.stringify({ title: 'Isolated metadata' }), '');
    });
    expect((await getVideoMeta(videoId)).title).toBe('Isolated metadata');
    expect(mocks.execFile.mock.calls[0][1]).toEqual(expect.arrayContaining(['--ignore-config', '--dump-json']));
    expect(mocks.execFile.mock.calls[0][1]).not.toContain('--cookies-from-browser');
  });
});

describe('other audio download paths', () => {
  it('uses the isolated cache in the legacy YouTube downloader', async () => {
    mocks.existsSync.mockReturnValue(true);
    expect(await legacyDownload(videoId)).toBe(`${customDir}/${videoId}.mp3`);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.existsSync).toHaveBeenCalledWith(`${customDir}/${videoId}.mp3`);
  });

  it('ignores local yt-dlp configuration in the legacy downloader when cookies are disabled', async () => {
    expect(await legacyDownload(videoId)).toBe(`${customDir}/${videoId}.mp3`);
    const downloadCall = mocks.execFile.mock.calls.find(([command]) => command === 'yt-dlp');
    expect(downloadCall?.[1]).toContain('--ignore-config');
    expect(downloadCall?.[1]).toContain(`${customDir}/${videoId}.mp3`);
  });

  it('writes downloaded direct audio bytes to the isolated directory', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    mocks.fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer });
    expect(await directDownload('https://example.test/audio.m4a', 'episode')).toBe(`${customDir}/episode.m4a`);
    expect(mocks.writeFileSync).toHaveBeenCalledWith(`${customDir}/episode.m4a`, Buffer.from(bytes));
    expect(mocks.existsSync.mock.calls.map(([pathname]) => pathname)).toEqual([customDir, `${customDir}/episode.m4a`]);
  });

  it('does not fetch direct audio when the isolated cache contains it', async () => {
    mocks.existsSync.mockReturnValue(true);
    expect(await directDownload('https://example.test/audio.m4a', 'episode')).toBe(`${customDir}/episode.m4a`);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
});
