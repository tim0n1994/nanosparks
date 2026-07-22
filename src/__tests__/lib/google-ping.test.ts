import { describe, it, expect } from 'vitest';
import { sitemapUrl } from '@/lib/seo/google-ping';

describe('sitemapUrl', () => {
  it('builds /sitemap.xml under the base', () => {
    expect(sitemapUrl('https://example.com')).toBe('https://example.com/sitemap.xml');
  });

  it('strips trailing slashes from base', () => {
    expect(sitemapUrl('https://example.com/')).toBe('https://example.com/sitemap.xml');
  });
});
