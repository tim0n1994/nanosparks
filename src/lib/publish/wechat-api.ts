/**
 * WeChat Official Account direct-publish client (B2) — PRD §B2 公众号双通道 a).
 *
 * For certified service accounts only: upload images as material → get media_id
 * → create a draft (draft/add) → optionally submit for publish (freepublish/submit).
 *
 * Token management: fetch and cache the access_token (2h lifetime) per appId.
 * This is the OFFICIAL direct channel; the clipboard fallback in channels.ts
 * covers uncertified accounts.
 *
 * All network calls are isolated here so the rest of the publish layer can be
 * tested without WeChat credentials.
 */

import { logger } from '@/lib/logger';

const WECHAT_BASE = 'https://api.weixin.qq.com/cgi-bin';
const TOKEN_TTL_MS = 110 * 60 * 1000; // cache token for 110 min (official TTL is 120 min)

export interface WeChatCredentials {
  appId: string;
  appSecret: string;
}

interface TokenCache {
  token: string;
 expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

/** Clear the in-memory access_token cache (for tests + credential rotation). */
export function clearWeChatTokenCache(): void {
  tokenCache.clear();
}

export class WeChatApiClient {
  private creds: WeChatCredentials;

  constructor(creds: WeChatCredentials) {
    this.creds = creds;
  }

  /** Fetch (and cache) a valid access_token for this appId. */
  async getAccessToken(): Promise<string> {
    const cached = tokenCache.get(this.creds.appId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const url = `${WECHAT_BASE}/token?grant_type=client_credential&appid=${this.creds.appId}&secret=${this.creds.appSecret}`;
    const resp = await fetch(url);
    const data = (await resp.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!data.access_token) {
      throw new Error(`WeChat token fetch failed: ${data.errcode} ${data.errmsg}`);
    }

    tokenCache.set(this.creds.appId, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : TOKEN_TTL_MS),
    });
    return data.access_token;
  }

  /**
   * Upload an image as permanent material (add_material, type=image).
   * Returns the media_id used to embed the image in article HTML.
   * PRD §B2: 图片先传素材接口换 media_id.
   */
  async uploadImageMaterial(imageBuffer: Buffer, filename: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${WECHAT_BASE}/material/add_material?access_token=${token}&type=image`;

    const form = new FormData();
    form.append('media', new Blob([new Uint8Array(imageBuffer)]), filename);

    const resp = await fetch(url, { method: 'POST', body: form });
    const data = (await resp.json()) as { media_id?: string; url?: string; errcode?: number; errmsg?: string };
    if (!data.media_id) {
      throw new Error(`WeChat material upload failed: ${data.errcode} ${data.errmsg}`);
    }
    logger.info('WeChat image material uploaded', { mediaId: data.media_id, url: data.url });
    return data.media_id;
  }

  /**
   * Create a draft article (draft/add). Returns the media_id of the draft.
   * PRD §B2: → draft/add, 用户在公众平台点发布.
   *
   * The article body must use inline styles from the whitelist (strong/em/
   * blockquote/p) and images referenced by their media_id.
   */
  async createDraft(article: {
    title: string;
    content: string; // HTML with whitelisted inline styles
    thumbMediaId: string;
    digest?: string;
    contentSourceUrl?: string;
  }): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${WECHAT_BASE}/draft/add?access_token=${token}`;

    const body = {
      articles: [
        {
          title: article.title,
          author: 'NanoSparks',
          digest: (article.digest ?? '').slice(0, 120), // PRD: digest ≤120 字
          content: article.content,
          thumb_media_id: article.thumbMediaId,
          need_open_comment: 1,
          only_fans_can_comment: 0,
          ...(article.contentSourceUrl ? { content_source_url: article.contentSourceUrl } : {}),
        },
      ],
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    if (!data.media_id) {
      throw new Error(`WeChat draft/add failed: ${data.errcode} ${data.errmsg}`);
    }
    logger.info('WeChat draft created', { mediaId: data.media_id });
    return data.media_id;
  }

  /**
   * Submit a draft for immediate publish (freepublish/submit).
   * PRD §B2: 或配置直接 freepublish/submit. Off by default; the human-in-the-loop
   * default is to stop at draft and let the user publish from the console.
   */
  async publishDraft(draftMediaId: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${WECHAT_BASE}/freepublish/submit?access_token=${token}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: draftMediaId }),
    });
    const data = (await resp.json()) as { publish_id?: string; errcode?: number; errmsg?: string };
    if (data.errcode) {
      throw new Error(`WeChat freepublish/submit failed: ${data.errcode} ${data.errmsg}`);
    }
    logger.info('WeChat draft submitted for publish', { draftMediaId, publishId: data.publish_id });
    return data.publish_id ?? '';
  }
}

/** Build a WeChat client from env (certified account credentials). Returns null if unconfigured. */
export function createWeChatClientFromEnv(): WeChatApiClient | null {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) return null;
  return new WeChatApiClient({ appId, appSecret });
}
