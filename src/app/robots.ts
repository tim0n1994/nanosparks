/**
 * robots.txt (PRD §C1 SEO: sitemap + 百度/Google 收录).
 * Allows all crawlers + points to the sitemap.
 */
import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://nanosparks.example';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/settings'],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
