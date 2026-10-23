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
