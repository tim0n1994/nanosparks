/**
 * Google Search Console ping (PRD §C1: sitemap + 百度站长主动推送 + Google).
 *
 * Google retired the old /ping endpoint, but submitting the sitemap via the
 * Search Console Indexing API (publish URL notifications) is the modern path.
 * This is a thin client that POSTs URL_UPDATED notifications. No-op when
 * unconfigured (no service account token).
 *
 * We keep this separate from baidu-push so each provider's quirks stay isolated.
 */

import { logger } from '@/lib/logger';

const INDEXING_API = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

export interface GoogleIndexingConfig {
  /** Service-account OAuth2 access token (scoped to indexing). */
  accessToken: string;
}

export function googleConfigFromEnv(): GoogleIndexingConfig | null {
  const accessToken = process.env.GOOGLE_INDEXING_TOKEN;
  if (!accessToken) return null;
  return { accessToken };
}

/**
 * Notify Google of updated/public URLs. Returns the API response or null on
 * failure / when unconfigured.
 */
export async function pushUrlsToGoogle(
  urls: string[],
  cfg: GoogleIndexingConfig | null = googleConfigFromEnv(),
): Promise<{ urlNotificationMetadata: { url: string; type: string } } | null> {
  if (!cfg || urls.length === 0) return null;

  try {
    // The Indexing API accepts one URL per call; batch sequentially (small N).
    let last: { urlNotificationMetadata: { url: string; type: string } } | null = null;
    for (const url of urls) {
      const resp = await fetch(INDEXING_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.accessToken}`,
        },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });
      if (resp.ok) {
        last = (await resp.json()) as { urlNotificationMetadata: { url: string; type: string } };
      } else {
        logger.warn('google indexing http error', { status: resp.status, url });
      }
    }
    logger.info('google indexing push done', { count: urls.length });
    return last;
  } catch (err) {
    logger.warn('google indexing failed', { error: String(err) });
    return null;
  }
}

/** Sitemap URL for a site base. Pure logic. */
export function sitemapUrl(base = process.env.NEXT_PUBLIC_SITE_URL || 'https://nanosparks.example'): string {
  return `${base.replace(/\/+$/, '')}/sitemap.xml`;
}
