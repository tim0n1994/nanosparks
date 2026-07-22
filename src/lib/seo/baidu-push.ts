/**
 * Baidu 站长主动推送 (PRD §C1: 百度站长主动推送 + Google).
 *
 * When a public page is published (slug assigned), we proactively push the URL
 * to Baidu's link-submission API so it's indexed faster than passive discovery.
 * Pure HTTP client — no deps. Configured via env; no-op when unconfigured.
 */

import { logger } from '@/lib/logger';

const BAIDU_PUSH_URL_TEMPLATE =
  'http://data.zz.baidu.com/urls?site=<SITE>&token=<TOKEN>';

export interface BaiduPushConfig {
  site: string; // e.g. nanosparks.example (verified site in Baidu webmaster)
  token: string;
}

/** Read Baidu push config from env. Returns null when unconfigured. */
export function baiduConfigFromEnv(): BaiduPushConfig | null {
  const site = process.env.BAIDU_PUSH_SITE;
  const token = process.env.BAIDU_PUSH_TOKEN;
  if (!site || !token) return null;
  return { site, token };
}

/** Build the push URL for a config. Pure logic — testable. */
export function buildBaiduPushUrl(cfg: BaiduPushConfig): string {
  return BAIDU_PUSH_URL_TEMPLATE.replace('<SITE>', encodeURIComponent(cfg.site)).replace(
    '<TOKEN>',
    encodeURIComponent(cfg.token),
  );
}

/**
 * Push one or more public URLs to Baidu. Returns the API response body.
 * No-op (returns null) when Baidu is not configured.
 */
export async function pushUrlsToBaidu(urls: string[], cfg: BaiduPushConfig | null = baiduConfigFromEnv()): Promise<{ success: number; remain: number; notSameSite?: string[]; notValid?: string[] } | null> {
  if (!cfg || urls.length === 0) return null;
  const endpoint = buildBaiduPushUrl(cfg);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: urls.join('\n'),
    });
    if (!resp.ok) {
      logger.warn('baidu push http error', { status: resp.status });
      return null;
    }
    const data = (await resp.json()) as { success: number; remain: number; not_same_site?: string[]; not_valid?: string[] };
    logger.info('baidu push ok', { pushed: data.success, remain: data.remain });
    return {
      success: data.success,
      remain: data.remain,
      notSameSite: data.not_same_site,
      notValid: data.not_valid,
    };
  } catch (err) {
    logger.warn('baidu push failed', { error: String(err) });
    return null;
  }
}

/** Build the public page URL for a slug. Pure logic. */
export function publicPageUrl(slug: string, base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nanosparks.example'): string {
  return `${base.replace(/\/+$/, '')}/p/${slug}`;
}
