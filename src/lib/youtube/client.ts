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
// Raw shape returned by channels.list (snippet + statistics).
interface RawChannelItem {
  id: string;
  snippet: { title: string; description: string; thumbnails: { high: { url: string } } };
  statistics: { subscriberCount: string };
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

  /** Same as fetch() but swallows errors (returns undefined). Used by the
   *  multi-attempt channel lookup (forHandle → forUsername → id) so a 404 on
   *  one identifier shape doesn't abort the whole resolution. */
  private async fetchSafe(endpoint: string, params: Record<string, string>): Promise<{ items?: RawChannelItem[] } | undefined> {
    try {
      return (await this.fetch(endpoint, params)) as { items?: RawChannelItem[] };
    } catch {
      return undefined;
    }
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
    // Channel identifiers come in three forms: legacy UC... ids, custom `/c/name`
    // vanity names, and modern `@handle`s. The Data API needs different query
    // params for each; resolveId picks the right one.
    const item = await this.resolveChannelItem(channelId);
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
    // channelId may be a handle/@name; resolve it to the real UC id before the
    // search query (which only accepts a real channel id).
    const realId = await this.resolveChannelId(channelId);
    const searchData = await this.fetch('search', {
      part: 'snippet',
      channelId: realId,
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
      channelId: realId,
    }));
  }

  /**
   * Resolve a channel identifier (UC id, /c vanity name, or @handle) to its
   * real UC channel id. Caches per-request to avoid repeat API calls.
   */
  private channelCache = new Map<string, string>();
  private async resolveChannelId(input: string): Promise<string> {
    const key = input.toLowerCase();
    if (this.channelCache.has(key)) return this.channelCache.get(key)!;
    // Legacy UC ids are already valid for every endpoint — pass them through
    // verbatim (channel ids are case-sensitive).
    if (/^UC/i.test(input)) {
      this.channelCache.set(key, input);
      return input;
    }
    const item = await this.resolveChannelItem(input);
    if (!item) throw new Error('Channel not found');
    this.channelCache.set(key, item.id);
    return item.id;
  }

  /**
   * Fetch the raw channel item across the three identifier shapes:
   *   1. forHandle — modern @handle (strip the leading '@')
   *   2. forUsername — legacy /c vanity name
   *   3. id — explicit UC id (fallback)
   * Returns undefined when the channel doesn't resolve under any of them.
   */
  private async resolveChannelItem(input: string): Promise<{
    id: string;
    snippet: { title: string; description: string; thumbnails: { high: { url: string } } };
    statistics: { subscriberCount: string };
  } | undefined> {
    const part = 'snippet,statistics';
    const handle = input.replace(/^@/, '');

    if (input.startsWith('@') || !/^UC/i.test(input)) {
      const byHandle = await this.fetchSafe('channels', { part, forHandle: `@${handle}` });
      if (byHandle?.items?.[0]) return byHandle.items[0];
      // fall back to legacy forUsername for /c/name style
      const byUsername = await this.fetchSafe('channels', { part, forUsername: handle });
      if (byUsername?.items?.[0]) return byUsername.items[0];
    }

    const byId = await this.fetchSafe('channels', { part, id: input });
    return byId?.items?.[0];
  }

  /** Fetch a playlist's title + its videos (PRD §A1: playlist → multi-episode). */
  async getPlaylist(playlistId: string, maxResults: number = 20): Promise<{ title: string; channelId: string; videos: YouTubeVideo[] }> {
    const playlistData = await this.fetch('playlists', {
      part: 'snippet,contentDetails',
      id: playlistId,
    }) as { items: Array<{ snippet: { title: string; channelId: string }; contentDetails: { itemCount: number } }> };

    if (!playlistData.items?.[0]) throw new Error('Playlist not found');
    const meta = playlistData.items[0];

    const itemsData = await this.fetch('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: String(maxResults),
    }) as { items: Array<{ snippet: { title: string; thumbnails: { high: { url: string } } }; contentDetails: { videoId: string; videoPublishedAt: string } }> };

    const videoIds = itemsData.items.map((i) => i.contentDetails.videoId).join(',');
    const videosData = await this.fetch('videos', {
      part: 'contentDetails',
      id: videoIds,
    }) as { items: Array<{ id: string; contentDetails: { duration: string } }> };
    const durationMap = new Map(videosData.items.map((v) => [v.id, v.contentDetails.duration]));

    const videos = itemsData.items.map((item) => ({
      id: item.contentDetails.videoId,
      title: item.snippet.title,
      description: '',
      duration: durationMap.get(item.contentDetails.videoId) || 'PT0S',
      thumbnailUrl: item.snippet.thumbnails.high?.url || '',
      publishedAt: item.contentDetails.videoPublishedAt,
      channelId: meta.snippet.channelId,
    }));

    return { title: meta.snippet.title, channelId: meta.snippet.channelId, videos };
  }
}
