/**
 * Bilibili resolver (A1).
 *
 * yt-dlp has native B站 support (b23.tv short links + bilibili.com). Some content
 * requires login cookies (充电专属/番剧), which surface as login_required errors.
 * platformId = the BV id (or content-hash fallback).
 */

import { getYtDlpMeta, classifyYtDlpError } from './ytdlp-meta';
import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey, contentHashPlatformId } from './episode-key';

const BILI_HOSTS = ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv'];

/** Extract a BV id (BV1xxxxxxxxxx) from a bilibili URL if present. */
function extractBvid(url: string): string | null {
  const m = url.match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : null;
}

export const bilibiliResolver: Resolver = {
  name: 'bilibili',
  canHandle(url) {
    try {
      return BILI_HOSTS.includes(new URL(url).hostname);
    } catch {
      return false;
    }
  },
  async resolve(url, ctx: ResolveCtx) {
    let meta;
    try {
      meta = await getYtDlpMeta(url, { cookies: ctx.cookies });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResolverError(
        `B站内容获取失败：${msg}`,
        classifyYtDlpError(msg),
        'bilibili',
      );
    }

    const bvid = extractBvid(url) ?? meta.id ?? contentHashPlatformId({ url });
    return {
      platform: 'bilibili',
      platformId: bvid,
      episodeKey: buildEpisodeKey('bilibili', bvid),
      title: meta.title || '未命名',
      description: meta.description,
      audioUrl: url, // audio fetched downstream by yt-dlp
      durationSec: meta.duration,
      coverUrl: meta.thumbnail,
      showTitle: meta.uploader,
      sourceUrl: url,
    };
  },
};
