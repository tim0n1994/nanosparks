/**
 * Generic yt-dlp resolver (A1) — the chain's last resort.
 *
 * yt-dlp supports 1000+ sites. Any URL not claimed by an earlier resolver is
 * handed here. platformId uses the extractor's native id when present, else a
 * content-hash fallback. Errors are classified into human-readable kinds.
 */

import { getYtDlpMeta, classifyYtDlpError } from './ytdlp-meta';
import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey, contentHashPlatformId } from './episode-key';

export const genericResolver: Resolver = {
  name: 'generic',
  canHandle(_url) {
    // Always true — this is the chain fallback. It is last in the ordered list.
    return true;
  },
  async resolve(url, ctx: ResolveCtx) {
    let meta;
    try {
      meta = await getYtDlpMeta(url, { cookies: ctx.cookies });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResolverError(`无法获取该链接的内容：${msg}`, classifyYtDlpError(msg), 'generic');
    }

    const platformId = meta.id || contentHashPlatformId({ url });
    return {
      platform: 'generic',
      platformId,
      episodeKey: buildEpisodeKey('generic', platformId),
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
