import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const youtubeMocks = vi.hoisted(() => ({
  getChannelMeta: vi.fn(),
  listChannelVideos: vi.fn(),
  getPlaylistMeta: vi.fn(),
  getVideoMeta: vi.fn(),
}));

const clientMocks = vi.hoisted(() => ({
  constructedKeys: [] as string[],
  getChannel: vi.fn(),
  getChannelVideos: vi.fn(),
  getPlaylist: vi.fn(),
}));

vi.mock('@/lib/youtube/channel', () => ({
  getChannelMeta: youtubeMocks.getChannelMeta,
  listChannelVideos: youtubeMocks.listChannelVideos,
  getPlaylistMeta: youtubeMocks.getPlaylistMeta,
}));

vi.mock('@/lib/youtube/ytdlp', () => ({
  getVideoMeta: youtubeMocks.getVideoMeta,
}));

vi.mock('@/lib/youtube/client', () => ({
  YouTubeClient: class {
    constructor(apiKey: string) {
      clientMocks.constructedKeys.push(apiKey);
    }

    getChannel = clientMocks.getChannel;
    getChannelVideos = clientMocks.getChannelVideos;
    getPlaylist = clientMocks.getPlaylist;
  },
}));

const { youtubeResolver } = await import('@/lib/resolvers/youtube');

const originalYouTubeKey = process.env.YOUTUBE_API_KEY;

beforeEach(() => {
  clientMocks.constructedKeys.length = 0;
  for (const mock of Object.values(youtubeMocks)) mock.mockReset();
  for (const mock of [clientMocks.getChannel, clientMocks.getChannelVideos, clientMocks.getPlaylist]) {
    mock.mockReset();
  }
  delete process.env.YOUTUBE_API_KEY;
});

afterEach(() => {
  if (originalYouTubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalYouTubeKey;
});

describe('youtubeResolver key routing', () => {
  it('uses yt-dlp for a channel when no key is configured', async () => {
    youtubeMocks.getChannelMeta.mockResolvedValue({
      title: 'Fallback Channel',
      description: 'yt-dlp description',
      thumbnailUrl: 'https://example.com/channel.jpg',
    });
    youtubeMocks.listChannelVideos.mockResolvedValue([
      { id: 'abcdefghijk', title: 'Fallback Episode', thumbnailUrl: 'https://example.com/video.jpg' },
    ]);

    const result = await youtubeResolver.resolve('https://www.youtube.com/@example-channel', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Fallback Channel');
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes?.[0]).toMatchObject({
      platform: 'youtube',
      platformId: 'abcdefghijk',
      title: 'Fallback Episode',
    });
    expect(clientMocks.constructedKeys).toEqual([]);
    expect(clientMocks.getChannel).not.toHaveBeenCalled();
    expect(clientMocks.getChannelVideos).not.toHaveBeenCalled();
    expect(youtubeMocks.getPlaylistMeta).not.toHaveBeenCalled();
  });

  it('uses the Data API for a channel when a real key is configured', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    clientMocks.getChannel.mockResolvedValue({
      title: 'API Channel',
      description: 'API description',
      thumbnailUrl: 'https://example.com/api-channel.jpg',
    });
    clientMocks.getChannelVideos.mockResolvedValue([
      { id: 'lmnopqrstuv', title: 'API Episode', thumbnailUrl: 'https://example.com/api-video.jpg' },
    ]);

    const result = await youtubeResolver.resolve('https://www.youtube.com/@example-channel', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('API Channel');
    expect(result.description).toBe('API description');
    expect(result.episodes?.[0]).toMatchObject({
      platform: 'youtube',
      platformId: 'lmnopqrstuv',
      title: 'API Episode',
    });
    expect(clientMocks.constructedKeys).toEqual(['AIzaSyRealTestKey1234567890']);
    expect(clientMocks.getChannel).toHaveBeenCalledWith('example-channel');
    expect(clientMocks.getChannelVideos).toHaveBeenCalledWith('example-channel', 20);
    expect(youtubeMocks.getChannelMeta).not.toHaveBeenCalled();
    expect(youtubeMocks.listChannelVideos).not.toHaveBeenCalled();
  });

  it('treats a placeholder as unconfigured and uses yt-dlp for a playlist', async () => {
    process.env.YOUTUBE_API_KEY = '<your-key>';
    youtubeMocks.getPlaylistMeta.mockResolvedValue({
      title: 'Fallback Playlist',
      videos: [
        { id: 'bcdefghijkl', title: 'Playlist Episode', thumbnailUrl: 'https://example.com/playlist-video.jpg' },
      ],
    });

    const result = await youtubeResolver.resolve('https://www.youtube.com/playlist?list=testlist', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Fallback Playlist');
    expect(result.episodes?.[0]).toMatchObject({
      platform: 'youtube',
      platformId: 'bcdefghijkl',
      title: 'Playlist Episode',
    });
    expect(clientMocks.constructedKeys).toEqual([]);
    expect(clientMocks.getPlaylist).not.toHaveBeenCalled();
  });

  it('uses the Data API for a playlist when a real key is configured', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey9876543210';
    clientMocks.getPlaylist.mockResolvedValue({
      title: 'API Playlist',
      videos: [
        { id: 'cdefghijkla', title: 'API Playlist Episode', thumbnailUrl: 'https://example.com/api-playlist-video.jpg' },
      ],
    });

    const result = await youtubeResolver.resolve('https://www.youtube.com/playlist?list=testlist', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('API Playlist');
    expect(result.episodes?.[0]).toMatchObject({
      platform: 'youtube',
      platformId: 'cdefghijkla',
      title: 'API Playlist Episode',
    });
    expect(clientMocks.constructedKeys).toEqual(['AIzaSyRealTestKey9876543210']);
    expect(clientMocks.getPlaylist).toHaveBeenCalledWith('testlist');
    expect(youtubeMocks.getPlaylistMeta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regression (2026-10-23): a configured key must not turn Data API failures
// into user-facing errors. resolveChannel/resolvePlaylist catch any API
// rejection (403/quota, network) and fall through to the zero-key yt-dlp
// listing (src/lib/resolvers/youtube.ts resolveChannel catch →
// getChannelMeta/listChannelVideos; resolvePlaylist catch → getPlaylistMeta).
// ---------------------------------------------------------------------------

describe('youtubeResolver Data API failure → yt-dlp fallback', () => {
  it('falls back to yt-dlp for a channel when the Data API rejects with 403/quota', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    clientMocks.getChannel.mockRejectedValue(new Error('YouTube API error: 403 Forbidden'));
    youtubeMocks.getChannelMeta.mockResolvedValue({
      title: 'Quota Fallback Channel',
      description: 'listed by yt-dlp after a 403',
      thumbnailUrl: 'https://example.com/quota-channel.jpg',
    });
    youtubeMocks.listChannelVideos.mockResolvedValue([
      { id: 'quota403abc1', title: 'Quota Fallback Episode', thumbnailUrl: 'https://example.com/quota-video.jpg' },
    ]);

    const result = await youtubeResolver.resolve('https://www.youtube.com/@example-channel', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Quota Fallback Channel');
    expect(result.episodes?.[0]).toMatchObject({
      platform: 'youtube',
      platformId: 'quota403abc1',
      title: 'Quota Fallback Episode',
    });
    // The Data API was attempted first with the configured key …
    expect(clientMocks.constructedKeys).toEqual(['AIzaSyRealTestKey1234567890']);
    expect(clientMocks.getChannel).toHaveBeenCalledWith('example-channel');
    // … but its videos call never ran after the 403, and yt-dlp took over.
    expect(clientMocks.getChannelVideos).not.toHaveBeenCalled();
    expect(youtubeMocks.getChannelMeta).toHaveBeenCalledWith('example-channel');
    expect(youtubeMocks.listChannelVideos).toHaveBeenCalledWith('example-channel', 20);
  });

  it('falls back to yt-dlp for a channel when the Data API videos call fails with a network error', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    // Channel meta resolves, but the videos search dies with a network error —
    // the whole API attempt must be abandoned, not half-returned.
    clientMocks.getChannel.mockResolvedValue({
      title: 'API Channel (stale)',
      description: 'API description',
      thumbnailUrl: 'https://example.com/api-channel.jpg',
    });
    clientMocks.getChannelVideos.mockRejectedValue(new TypeError('fetch failed'));
    youtubeMocks.getChannelMeta.mockResolvedValue({
      title: 'Network Fallback Channel',
      description: 'listed by yt-dlp after a network error',
      thumbnailUrl: 'https://example.com/net-channel.jpg',
    });
    youtubeMocks.listChannelVideos.mockResolvedValue([
      { id: 'netfail12345', title: 'Network Fallback Episode', thumbnailUrl: 'https://example.com/net-video.jpg' },
    ]);

    const result = await youtubeResolver.resolve('https://www.youtube.com/@example-channel', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Network Fallback Channel');
    expect(result.episodes?.[0]).toMatchObject({
      platformId: 'netfail12345',
      title: 'Network Fallback Episode',
    });
    expect(clientMocks.getChannel).toHaveBeenCalledTimes(1);
    expect(clientMocks.getChannelVideos).toHaveBeenCalledTimes(1);
    expect(youtubeMocks.getChannelMeta).toHaveBeenCalledWith('example-channel');
    expect(youtubeMocks.listChannelVideos).toHaveBeenCalledWith('example-channel', 20);
  });

  it('falls back to yt-dlp for a playlist when the Data API rejects with 403/quota', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    clientMocks.getPlaylist.mockRejectedValue(new Error('YouTube API error: 403 Forbidden'));
    youtubeMocks.getPlaylistMeta.mockResolvedValue({
      title: 'Quota Fallback Playlist',
      videos: [
        { id: 'plquota403ab', title: 'Quota Playlist Episode', thumbnailUrl: 'https://example.com/pl-quota-video.jpg' },
      ],
    });

    const result = await youtubeResolver.resolve('https://www.youtube.com/playlist?list=testlist', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Quota Fallback Playlist');
    expect(result.episodes?.[0]).toMatchObject({
      platformId: 'plquota403ab',
      title: 'Quota Playlist Episode',
    });
    expect(clientMocks.constructedKeys).toEqual(['AIzaSyRealTestKey1234567890']);
    expect(clientMocks.getPlaylist).toHaveBeenCalledWith('testlist');
    expect(youtubeMocks.getPlaylistMeta).toHaveBeenCalledWith('testlist', 20);
  });

  it('falls back to yt-dlp for a playlist when the Data API rejects with a network error', async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    clientMocks.getPlaylist.mockRejectedValue(new TypeError('fetch failed'));
    youtubeMocks.getPlaylistMeta.mockResolvedValue({
      title: 'Network Fallback Playlist',
      videos: [
        { id: 'plnetfail12', title: 'Network Playlist Episode', thumbnailUrl: 'https://example.com/pl-net-video.jpg' },
      ],
    });

    const result = await youtubeResolver.resolve('https://www.youtube.com/playlist?list=testlist', {});

    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('Network Fallback Playlist');
    expect(result.episodes?.[0]).toMatchObject({
      platformId: 'plnetfail12',
      title: 'Network Playlist Episode',
    });
    expect(clientMocks.getPlaylist).toHaveBeenCalledTimes(1);
    expect(youtubeMocks.getPlaylistMeta).toHaveBeenCalledWith('testlist', 20);
  });
});

// ---------------------------------------------------------------------------
// YTDLP_PATH contract: the zero-key fallback must exec the binary at
// $YTDLP_PATH (src/lib/youtube/channel.ts execFileAsync:
// `process.env.YTDLP_PATH || cmd`), never a bare `yt-dlp` that may not exist
// on PATH. These tests re-import the resolver with the REAL channel module
// (vi.doUnmock) so the yt-dlp branch actually runs against a mocked
// child_process.execFile; YTDLP_PATH points at a fake path, so a contract
// break cannot spawn a real binary.
// ---------------------------------------------------------------------------

const childProcessMocks = vi.hoisted(() => ({ execFile: vi.fn() }));

// Node builtins go through CJS interop in the runner, so the mock factory
// must expose both the named export and a `default` carrying it.
vi.mock('node:child_process', () => {
  const mocked = { execFile: childProcessMocks.execFile };
  return { ...mocked, default: mocked };
});
vi.mock('child_process', () => {
  const mocked = { execFile: childProcessMocks.execFile };
  return { ...mocked, default: mocked };
});

const fakeYtDlpPath = '/nonexistent-ytdlp-bin/yt-dlp';
const originalYtdlpPath = process.env.YTDLP_PATH;

describe('YTDLP_PATH contract: yt-dlp fallback execs $YTDLP_PATH, never bare yt-dlp', () => {
  let freshResolver: typeof youtubeResolver;

  beforeEach(async () => {
    process.env.YOUTUBE_API_KEY = 'AIzaSyRealTestKey1234567890';
    process.env.YTDLP_PATH = fakeYtDlpPath;
    clientMocks.getChannel.mockRejectedValue(new Error('YouTube API error: 403 Forbidden'));
    clientMocks.getPlaylist.mockRejectedValue(new Error('YouTube API error: 403 Forbidden'));
    childProcessMocks.execFile.mockReset();
    // --flat-playlist calls list videos; every other call (channel meta,
    // playlist title) gets a metadata dump covering both shapes.
    childProcessMocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const stdout = args.includes('--flat-playlist')
          ? `${JSON.stringify({ id: 'ytdlpabcde1', title: 'yt-dlp fallback video', duration: 120 })}\n`
          : `${JSON.stringify({
              channel: 'yt-dlp channel',
              channel_id: 'UCytdlp00001',
              description: 'listed by yt-dlp',
              playlist_title: 'yt-dlp playlist',
              thumbnails: [{ url: 'https://example.com/ytdlp-avatar.jpg' }],
            })}\n`;
        callback(null, stdout, '');
      },
    );

    // Fresh module graph: real @/lib/youtube/channel + mocked execFile. The
    // hoisted vi.mock factories for client/ytdlp still apply to it.
    vi.resetModules();
    vi.doUnmock('@/lib/youtube/channel');
    freshResolver = (await import('@/lib/resolvers/youtube')).youtubeResolver;
  });

  afterEach(() => {
    if (originalYtdlpPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = originalYtdlpPath;
  });

  it('execs $YTDLP_PATH for a channel after the Data API fails', async () => {
    const result = await freshResolver.resolve('https://www.youtube.com/@example-channel', {});

    // API-first with the configured key, then the real channel module ran.
    expect(clientMocks.constructedKeys).toEqual(['AIzaSyRealTestKey1234567890']);
    expect(clientMocks.getChannel).toHaveBeenCalledTimes(1);
    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('yt-dlp channel');
    expect(result.episodes?.[0]).toMatchObject({ platformId: 'ytdlpabcde1', title: 'yt-dlp fallback video' });

    // Every yt-dlp invocation used $YTDLP_PATH — none used a bare 'yt-dlp'.
    const commands = childProcessMocks.execFile.mock.calls.map((call) => call[0]);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toBe(fakeYtDlpPath);
    }
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      fakeYtDlpPath,
      expect.arrayContaining(['--flat-playlist', '--dump-json', 'https://www.youtube.com/@example-channel/videos']),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('execs $YTDLP_PATH for a playlist after the Data API fails', async () => {
    const result = await freshResolver.resolve('https://www.youtube.com/playlist?list=testlist', {});

    expect(clientMocks.getPlaylist).toHaveBeenCalledTimes(1);
    expect(result.isMultiEpisode).toBe(true);
    expect(result.title).toBe('yt-dlp playlist');
    expect(result.episodes?.[0]).toMatchObject({ platformId: 'ytdlpabcde1', title: 'yt-dlp fallback video' });

    // Every yt-dlp invocation used $YTDLP_PATH — none used a bare 'yt-dlp'.
    const commands = childProcessMocks.execFile.mock.calls.map((call) => call[0]);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).toBe(fakeYtDlpPath);
    }
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      fakeYtDlpPath,
      expect.arrayContaining(['--flat-playlist', '--dump-json', 'https://www.youtube.com/playlist?list=testlist']),
      expect.anything(),
      expect.any(Function),
    );
  });
});
