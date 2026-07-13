import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YouTubeClient } from '@/lib/youtube/client';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('YouTubeClient', () => {
  let client: YouTubeClient;

  beforeEach(() => {
    client = new YouTubeClient('test-api-key');
    mockFetch.mockReset();
  });

  describe('getVideo', () => {
    it('fetches video metadata and maps response correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            id: 'abc123',
            snippet: {
              title: 'Test Video',
              description: 'A test description',
              thumbnails: { high: { url: 'http://thumb.jpg' } },
              publishedAt: '2024-01-01T00:00:00Z',
              channelId: 'UCtest123',
            },
            contentDetails: { duration: 'PT5M30S' },
          }],
        }),
      } as Response);

      const video = await client.getVideo('abc123');

      expect(video.id).toBe('abc123');
      expect(video.title).toBe('Test Video');
      expect(video.duration).toBe('PT5M30S');
      expect(video.channelId).toBe('UCtest123');
    });

    it('throws when video not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      } as Response);

      await expect(client.getVideo('notfound')).rejects.toThrow('Video not found');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as Response);

      await expect(client.getVideo('abc123')).rejects.toThrow('YouTube API error: 403 Forbidden');
    });

    it('includes API key in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            id: 'abc123',
            snippet: {
              title: 'T',
              description: '',
              thumbnails: { high: { url: '' } },
              publishedAt: '',
              channelId: 'UCx',
            },
            contentDetails: { duration: 'PT0S' },
          }],
        }),
      } as Response);

      await client.getVideo('abc123');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('key=test-api-key');
    });
  });

  describe('getChannel', () => {
    it('returns channel data with subscriber count', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{
            id: 'UCtest',
            snippet: {
              title: 'Test Channel',
              description: 'Channel desc',
              thumbnails: { high: { url: 'http://ch-thumb.jpg' } },
            },
            statistics: { subscriberCount: '1000' },
          }],
        }),
      } as Response);

      const channel = await client.getChannel('UCtest');

      expect(channel.title).toBe('Test Channel');
      expect(channel.subscriberCount).toBe(1000);
    });
  });

  describe('getChannelVideos', () => {
    it('returns array of video objects with duration', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              { id: { videoId: 'v1' }, snippet: { title: 'V1', description: '', thumbnails: { high: { url: '' } }, publishedAt: '' } },
              { id: { videoId: 'v2' }, snippet: { title: 'V2', description: '', thumbnails: { high: { url: '' } }, publishedAt: '' } },
            ],
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              { id: 'v1', contentDetails: { duration: 'PT3M' } },
              { id: 'v2', contentDetails: { duration: 'PT10M' } },
            ],
          }),
        } as Response);

      const videos = await client.getChannelVideos('UCtest', 10);

      expect(videos).toHaveLength(2);
      expect(videos[0].duration).toBe('PT3M');
      expect(videos[0].channelId).toBe('UCtest');
    });
  });
});
