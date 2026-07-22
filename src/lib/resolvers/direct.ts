/**
 * Direct audio URL resolver (A1).
 *
 * A raw link to an audio file (mp3/m4a/wav/flac/ogg/webm). We verify it is actually
 * audio via Content-Type + ffprobe-style extension check before accepting. platformId
 * has no native id, so we fall back to a content-hash of (url + size + head bytes).
 */

import type { Resolver, ResolveCtx } from './types';
import { ResolverError } from './types';
import { buildEpisodeKey, contentHashPlatformId } from './episode-key';

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.webm', '.aac', '.opus'];

export const directResolver: Resolver = {
  name: 'direct',
  canHandle(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.toLowerCase();
      return AUDIO_EXTS.some((ext) => path.endsWith(ext));
    } catch {
      return false;
    }
  },
  async resolve(url, ctx: ResolveCtx) {
    const controller = new AbortController();
    if (ctx.signal) ctx.signal.addEventListener('abort', () => controller.abort());

    // Probe Content-Type + size via a small ranged GET.
    let size: number | undefined;
 let contentType = '';
    let head: string | undefined;
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        method: 'GET',
        headers: { Range: 'bytes=0-4095', 'User-Agent': 'NanoSparks/1.0' },
        redirect: 'follow',
      });
      contentType = (resp.headers.get('content-type') || '').toLowerCase();
      const cl = resp.headers.get('content-range');
      if (cl) {
        const m = cl.match(/\/(\d+)/);
        if (m) size = parseInt(m[1], 10);
      } else if (resp.headers.get('content-length')) {
        size = parseInt(resp.headers.get('content-length')!, 10);
      }
      if (resp.ok || resp.status === 206) {
        const buf = Buffer.from(await resp.arrayBuffer());
        head = buf.slice(0, 32).toString('base64');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ResolverError(`音频直链无法访问：${msg}`, 'unknown', 'direct');
    }

    const isAudioType = contentType.startsWith('audio') || contentType.includes('mpeg');
    const ext = new URL(url).pathname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
    const isAudioExt = AUDIO_EXTS.includes(ext);

    if (!isAudioType && !isAudioExt) {
      throw new ResolverError(
        '该链接不是音频文件（Content-Type 与扩展名均非音频）。',
       'no_audio',
       'direct',
     );
    }

    // PRD §A1: 大小上限熔断（与护栏 4h 上限对齐，~500MB 典型码率）。
    const maxSizeBytes = Number(process.env.RESOLVER_MAX_DIRECT_BYTES ?? 500 * 1024 * 1024);
    if (size && size > maxSizeBytes) {
      throw new ResolverError(
        `音频文件过大（${Math.round(size / 1024 / 1024)}MB 超过上限 ${Math.round(maxSizeBytes / 1024 / 1024)}MB）`,
        'no_audio',
        'direct',
      );
    }

    const platformId = contentHashPlatformId({ url, size, head });
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '未命名音频');

    return {
      platform: 'direct',
      platformId,
      episodeKey: buildEpisodeKey('direct', platformId),
      title: name,
      audioUrl: url,
      durationSec: undefined, // resolved downstream by ffprobe after download
      sourceUrl: url,
    };
  },
};
