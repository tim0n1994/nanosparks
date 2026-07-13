import { z } from 'zod';

const youtubeUrlSchema = z.string().url().refine(
  (url) => {
    const patterns = [
      /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/,
      /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=/,
      /^https?:\/\/(www\.)?youtube\.com\/channel\//,
      /^https?:\/\/(www\.)?youtube\.com\/c\//,
      /^https?:\/\/(www\.)?youtube\.com\/@/,
      /^https?:\/\/youtu\.be\//,
    ];
    return patterns.some((p) => p.test(url));
  },
  { message: 'Invalid YouTube URL' }
);

export function parseYouTubeUrl(url: string): {
  type: 'video' | 'playlist' | 'channel';
  id: string;
} {
  const validated = youtubeUrlSchema.parse(url);

  const videoMatch = validated.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (videoMatch) {
    return { type: 'video', id: videoMatch[1] };
  }

  const playlistMatch = validated.match(/list=([a-zA-Z0-9_-]+)/);
  if (playlistMatch) {
    return { type: 'playlist', id: playlistMatch[1] };
  }

  const channelMatch = validated.match(/(?:channel\/|c\/|@)([^/?]+)/);
  if (channelMatch) {
    return { type: 'channel', id: channelMatch[1] };
  }

  throw new Error('Could not extract ID from URL');
}
