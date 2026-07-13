const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  duration: string;
  thumbnailUrl: string;
  publishedAt: string;
  channelId: string;
}

interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
}

export class YouTubeClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({ ...params, key: this.apiKey });
    const response = await fetch(`${YOUTUBE_API_BASE}/${endpoint}?${query}`);

    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getVideo(videoId: string): Promise<YouTubeVideo> {
    const data = await this.fetch('videos', {
      part: 'snippet,contentDetails',
      id: videoId,
    }) as { items: Array<{ id: string; snippet: { title: string; description: string; thumbnails: { high: { url: string } }; publishedAt: string; channelId: string }; contentDetails: { duration: string } }> };

    const item = data.items[0];
    if (!item) throw new Error('Video not found');

    return {
      id: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      duration: item.contentDetails.duration,
      thumbnailUrl: item.snippet.thumbnails.high?.url || '',
      publishedAt: item.snippet.publishedAt,
      channelId: item.snippet.channelId,
    };
  }

  async getChannel(channelId: string): Promise<YouTubeChannel> {
    const data = await this.fetch('channels', {
      part: 'snippet,statistics',
      id: channelId,
    }) as { items: Array<{ id: string; snippet: { title: string; description: string; thumbnails: { high: { url: string } } }; statistics: { subscriberCount: string } }> };

    const item = data.items[0];
    if (!item) throw new Error('Channel not found');

    return {
      id: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: item.snippet.thumbnails.high?.url || '',
      subscriberCount: parseInt(item.statistics.subscriberCount, 10),
    };
  }

  async getChannelVideos(channelId: string, maxResults: number = 10): Promise<YouTubeVideo[]> {
    const searchData = await this.fetch('search', {
      part: 'snippet',
      channelId,
      maxResults: String(maxResults),
      order: 'date',
      type: 'video',
    }) as { items: Array<{ id: { videoId: string }; snippet: { title: string; description: string; thumbnails: { high: { url: string } }; publishedAt: string } }> };

    const videoIds = searchData.items.map((item) => item.id.videoId).join(',');
    const videosData = await this.fetch('videos', {
      part: 'contentDetails',
      id: videoIds,
    }) as { items: Array<{ id: string; contentDetails: { duration: string } }> };

    const durationMap = new Map(videosData.items.map((v) => [v.id, v.contentDetails.duration]));

    return searchData.items.map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      duration: durationMap.get(item.id.videoId) || 'PT0S',
      thumbnailUrl: item.snippet.thumbnails.high?.url || '',
      publishedAt: item.snippet.publishedAt,
      channelId,
    }));
  }
}
