/**
 * Xiaoyuzhou FM (小宇宙) Client
 *
 * Scrapes the Xiaoyuzhou podcast/episode page to extract metadata.
 * The page contains a __NEXT_DATA__ script with all podcast + episode info.
 * No official API or RSS feed needed — we scrape directly.
 */

import { logger } from '@/lib/logger';
import { withRetry } from '@/lib/resolvers/retry';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// PRD §A1 小宇宙频控: request rate limit (min gap between requests) + UA spoofing.
// Serialize + space out requests so we don't trip the platform's scraper detection.
const MIN_REQUEST_GAP_MS = Number(process.env.XIAOYUZHOU_MIN_GAP_MS ?? 1500);
let lastRequestAt = 0;
let requestChain: Promise<unknown> = Promise.resolve();

/** Throttle a fetch to respect the min-gap (PRD: 请求限速). */
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const elapsed = Date.now() - lastRequestAt;
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - elapsed);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
  });
  requestChain = run.catch(() => undefined);
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Test-only: reset the throttle state (for deterministic tests). */
export function __resetXiaoyuzhouThrottle(): void {
  lastRequestAt = 0;
  requestChain = Promise.resolve();
}

export interface XiaoyuzhouPodcast {
  pid: string;
  title: string;
  author: string;
  description: string;
  image: string;
  episodeCount: number;
}

export interface XiaoyuzhouEpisode {
  eid: string;
  title: string;
  description: string;
  /** Duration in seconds */
  duration: number;
  /** Publish date ISO string */
  pubDate: string;
  /** Audio URL (.m4a on media.xyzcdn.net) */
  audioUrl: string;
  /** Episode image URL */
  image: string;
}

/**
 * Fetch podcast metadata + recent episodes from a Xiaoyuzhou podcast page.
 */
export async function getPodcast(pid: string): Promise<{
  podcast: XiaoyuzhouPodcast;
  episodes: XiaoyuzhouEpisode[];
}> {
  const url = `https://www.xiaoyuzhoufm.com/podcast/${pid}`;
  const html = await fetchPage(url);

  const { podcast, episodes } = extractPodcastData(html, pid);

  logger.info(`Xiaoyuzhou podcast fetched`, {
    title: podcast.title,
    episodes: episodes.length,
  });

  return { podcast, episodes };
}

/**
 * Fetch a single episode + its parent podcast metadata from a Xiaoyuzhou episode page.
 */
export async function getEpisode(eid: string): Promise<{
  podcast: XiaoyuzhouPodcast;
  episode: XiaoyuzhouEpisode;
}> {
  const url = `https://www.xiaoyuzhoufm.com/episode/${eid}`;
  const html = await fetchPage(url);

  const { podcast, episode } = extractEpisodeData(html, eid);

  logger.info(`Xiaoyuzhou episode fetched`, {
    title: episode.title,
    podcast: podcast.title,
  });

  return { podcast, episode };
}

/**
 * Parse __NEXT_DATA__ JSON from any Xiaoyuzhou page.
 */
function parseNextData(html: string): Record<string, unknown> {
  const scriptStart = html.indexOf('__NEXT_DATA__');
  if (scriptStart === -1) {
    throw new Error('Could not find data on page (__NEXT_DATA__ missing)');
  }

  const scriptTagStart = html.indexOf('>', scriptStart) + 1;
  const scriptEnd = html.indexOf('</script>', scriptTagStart);
  if (scriptEnd === -1) {
    throw new Error('Could not find end of __NEXT_DATA__ script');
  }

  const jsonStr = html.slice(scriptTagStart, scriptEnd).trim();
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    throw new Error('Failed to parse __NEXT_DATA__ JSON');
  }
}

/**
 * Extract podcast + episode data from a podcast page HTML.
 */
function extractPodcastData(
  html: string,
  expectedPid: string,
): { podcast: XiaoyuzhouPodcast; episodes: XiaoyuzhouEpisode[] } {
  const data = parseNextData(html);
  const props = (data.props as Record<string, unknown>) ?? {};
  const pageProps = (props.pageProps as Record<string, unknown>) ?? {};
  const podcastData = pageProps.podcast as Record<string, unknown> | undefined;

  if (!podcastData) {
    throw new Error('No podcast data found in page');
  }

  const pid = podcastData.pid as string;
  if (pid !== expectedPid) {
    logger.warn('Podcast ID mismatch', { expected: expectedPid, actual: pid });
  }

  const podcast: XiaoyuzhouPodcast = {
    pid,
    title: (podcastData.title as string) ?? 'Unknown',
    author: (podcastData.author as string) ?? '',
    description: (podcastData.brief as string) ?? (podcastData.description as string) ?? '',
    image: extractImageUrl(podcastData.image),
    episodeCount: (podcastData.episodeCount as number) ?? 0,
  };

  const rawEpisodes = (podcastData.episodes as unknown[]) ?? [];
  const episodes: XiaoyuzhouEpisode[] = rawEpisodes.map((raw: unknown) => {
    const ep = raw as Record<string, unknown>;
    const media = ep.media as Record<string, unknown> | undefined;
    const source = media?.source as Record<string, unknown> | undefined;
    const audioUrl = (source?.url as string) ?? '';

    return {
      eid: (ep.eid as string) ?? '',
      title: (ep.title as string) ?? 'Untitled',
      description: (ep.description as string) ?? '',
      duration: (ep.duration as number) ?? 0,
      pubDate: (ep.pubDate as string) ?? '',
      audioUrl,
      image: extractImageUrl(ep.image),
    };
  });

  return { podcast, episodes };
}

/**
 * Extract episode + podcast data from an episode page HTML.
 */
function extractEpisodeData(
  html: string,
  expectedEid: string,
): { podcast: XiaoyuzhouPodcast; episode: XiaoyuzhouEpisode } {
  const data = parseNextData(html);
  const props = (data.props as Record<string, unknown>) ?? {};
  const pageProps = (props.pageProps as Record<string, unknown>) ?? {};
  const episodeData = pageProps.episode as Record<string, unknown> | undefined;

  if (!episodeData) {
    throw new Error('No episode data found in page');
  }

  const eid = episodeData.eid as string;
  if (eid !== expectedEid) {
    logger.warn('Episode ID mismatch', { expected: expectedEid, actual: eid });
  }

  const podcastData = episodeData.podcast as Record<string, unknown> | undefined;
  if (!podcastData) {
    throw new Error('No podcast data found in episode page');
  }

  const podcast: XiaoyuzhouPodcast = {
    pid: (podcastData.pid as string) ?? '',
    title: (podcastData.title as string) ?? 'Unknown',
    author: (podcastData.author as string) ?? '',
    description: (podcastData.brief as string) ?? (podcastData.description as string) ?? '',
    image: extractImageUrl(podcastData.image),
    episodeCount: (podcastData.episodeCount as number) ?? 0,
  };

  const media = episodeData.media as Record<string, unknown> | undefined;
  const source = media?.source as Record<string, unknown> | undefined;
  const audioUrl = (source?.url as string) ?? '';

  const episode: XiaoyuzhouEpisode = {
    eid,
    title: (episodeData.title as string) ?? 'Untitled',
    description: (episodeData.description as string) ?? '',
    duration: (episodeData.duration as number) ?? 0,
    pubDate: (episodeData.pubDate as string) ?? '',
    audioUrl,
    image: extractImageUrl(episodeData.image),
  };

  return { podcast, episode };
}

/**
 * Extract a URL string from various image formats.
 * Xiaoyuzhou images can be { url, width, height } or a plain string.
 */
function extractImageUrl(image: unknown): string {
  if (!image) return '';
  if (typeof image === 'string') return image;
  if (typeof image === 'object') {
    const obj = image as Record<string, unknown>;
    return (obj.url as string) ?? (obj.thumbnail as string) ?? '';
  }
  return '';
}

/**
 * Fetch a page with browser-like headers.
 */
async function fetchPage(url: string): Promise<string> {
  const response = await withRetry(() => throttled(() => fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })), { retries: 2 });

  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
  }

  return response.text();
}
