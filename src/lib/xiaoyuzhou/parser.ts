/**
 * Xiaoyuzhou FM (小宇宙) URL parser.
 *
 * URL format:
 *   Podcast: https://www.xiaoyuzhoufm.com/podcast/{pid}
 *   Episode: https://www.xiaoyuzhoufm.com/episode/{eid}
 */

const XIAOYUZHOU_HOSTS = [
  'www.xiaoyuzhoufm.com',
  'xiaoyuzhoufm.com',
];

export function isXiaoyuzhouUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return XIAOYUZHOU_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function parseXiaoyuzhouUrl(url: string): {
  type: 'podcast' | 'episode';
  id: string;
} {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, ''); // strip trailing slash

  // /podcast/{pid}
  const podcastMatch = path.match(/^\/podcast\/([a-f0-9]{24})$/);
  if (podcastMatch) {
    return { type: 'podcast', id: podcastMatch[1] };
  }

  // /episode/{eid}
  const episodeMatch = path.match(/^\/episode\/([a-f0-9]{24})$/);
  if (episodeMatch) {
    return { type: 'episode', id: episodeMatch[1] };
  }

  throw new Error(`Unrecognized Xiaoyuzhou URL: ${url}`);
}
