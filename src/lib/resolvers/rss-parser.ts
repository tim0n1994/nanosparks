/**
 * RSS / podcast feed parser (A1).
 *
 * Used by both the Apple resolver (feedUrl from iTunes Lookup) and the generic
 * RSS resolver. Handles common podcast RSS 2.0 + itunes:* extension tags:
 * title, description, image, and per-episode enclosure URL + itunes:duration.
 * fetch follows chartable/podtrac redirect prefixes by default.
 */

import { logger } from '@/lib/logger';

export interface RssEpisode {
  guid: string;
  title: string;
  description?: string;
  enclosureUrl: string;
  enclosureType?: string;
  durationSec?: number;
  pubDate?: string;
}

export interface ParsedFeed {
  title: string;
  description?: string;
  image?: string;
  link?: string;
  episodes: RssEpisode[];
}

/** Parse "HH:MM:SS" or "MM:SS" or plain seconds into seconds. */
function parseDuration(raw?: string): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw.trim())) return parseInt(raw, 10);
  const parts = raw.trim().split(':').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs;
}

/** Strip XML namespaces so tag matching below stays simple. */
function stripNamespaces(xml: string): string {
  return xml.replace(/<(\/?)([a-zA-Z0-9]+):/g, '<$1$2_');
}

function firstTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  return xml.match(re) ?? [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parse a podcast RSS feed from raw XML. Hand-rolled (no DOM dependency) so the
 * resolver chain stays fast and dependency-light.
 */
export function parseRssXml(xml: string): ParsedFeed {
  const ns = stripNamespaces(xml);
  const channelBlock = ns.match(/<channel\b[\s\S]*?<\/channel>/i)?.[0] ?? ns;

  // itunes:image is usually self-closing (<itunes:image href="..."/>), so match
  // the whole element (not its inner text) then pull the href attribute.
  let image = channelBlock.match(/<itunes_image\b[^>]*>/i)?.[0]?.match(/href="([^"]+)"/i)?.[1];
  if (!image) {
    const imgBlock = firstTag(channelBlock, 'image');
    if (imgBlock) image = firstTag(imgBlock, 'url');
  }
  const summary = firstTag(channelBlock, 'itunes_summary');

  const episodes: RssEpisode[] = allBlocks(channelBlock, 'item').map((item) => {
    const guid = firstTag(item, 'guid') ?? '';
    const title = firstTag(item, 'title') ?? '未命名';
    const enclosureMatch = item.match(/<enclosure\b[^>]*url="([^"]+)"/i);
    const enclosureType = item.match(/<enclosure\b[^>]*type="([^"]+)"/i)?.[1];
    const duration = parseDuration(firstTag(item, 'itunes_duration'));
    const pubDate = firstTag(item, 'pubDate');
    const desc =
      firstTag(item, 'itunes_summary') ||
      firstTag(item, 'description') ||
      firstTag(item, 'content_encoded');

    return {
      guid,
      title,
      description: desc,
      enclosureUrl: enclosureMatch ? decodeEntities(enclosureMatch[1]) : '',
      enclosureType,
      durationSec: duration,
      pubDate,
    };
  });

  return {
    title: firstTag(channelBlock, 'title') ?? '未命名播客',
    description: summary || firstTag(channelBlock, 'description'),
    image,
    link: firstTag(channelBlock, 'link'),
    episodes: episodes.filter((e) => e.enclosureUrl),
  };
}

/** Fetch + parse a remote RSS feed URL. */
export async function parseRssFeed(feedUrl: string, signal?: AbortSignal): Promise<ParsedFeed> {
  logger.info(`RSS feed fetch`, { url: feedUrl });
  const resp = await fetch(feedUrl, {
    signal,
    headers: { 'User-Agent': 'NanoSparks/1.0 (podcast reader)' },
  });
  if (!resp.ok) {
    throw new Error(`RSS feed fetch failed ${resp.status}: ${feedUrl}`);
  }
  const xml = await resp.text();
  return parseRssXml(xml);
}
