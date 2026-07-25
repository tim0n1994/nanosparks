/**
 * Cover-art CDNs we optimise through next/image.
 *
 * Shared by next.config.ts (to build `images.remotePatterns`) and by
 * CoverImage (to decide, at render time, whether a given URL can go through
 * the optimiser). Keeping one list means the two can never drift — a host in
 * the component but not the config throws at runtime.
 */
export const IMAGE_HOST_PATTERNS = [
  // YouTube
  'i.ytimg.com',
  'img.youtube.com',
  // 小宇宙 / xiaoyuzhou
  '**.xyzcdn.net',
  // Apple Podcasts
  '**.mzstatic.com',
  // Bilibili
  '**.hdslb.com',
] as const;

/** Matches a remotePatterns-style hostname (supports a leading `**.`). */
function hostMatches(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('**.')) {
    const suffix = pattern.slice(2); // keep the leading dot
    return hostname.endsWith(suffix);
  }
  return hostname === pattern;
}

/**
 * True when `url` points at a host next/image is configured to fetch.
 * Anything else must render as a plain <img> — passing it to next/image
 * raises "hostname is not configured under images".
 */
export function isOptimizableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    hostname = parsed.hostname;
  } catch {
    return false;
  }
  return IMAGE_HOST_PATTERNS.some((p) => hostMatches(hostname, p));
}
