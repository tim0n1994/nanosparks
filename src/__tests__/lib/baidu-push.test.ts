import { describe, it, expect } from 'vitest';
import { buildBaiduPushUrl, publicPageUrl, type BaiduPushConfig } from '@/lib/seo/baidu-push';

const cfg: BaiduPushConfig = { site: 'nanosparks.example', token: 'tok123' };

describe('buildBaiduPushUrl', () => {
  it('builds the baidu push endpoint with site + token', () => {
    const url = buildBaiduPushUrl(cfg);
    expect(url).toContain('site=nanosparks.example');
    expect(url).toContain('token=tok123');
    expect(url).toContain('data.zz.baidu.com/urls');
  });

  it('encodes special characters in site/token', () => {
    const url = buildBaiduPushUrl({ site: 'a b', token: 'x/y' });
    expect(url).toContain('site=a%20b');
    expect(url).toContain('token=x%2Fy');
  });
});

describe('publicPageUrl', () => {
  it('builds /p/[slug] under the base', () => {
    expect(publicPageUrl('my-slug', 'https://example.com')).toBe('https://example.com/p/my-slug');
  });

  it('strips trailing slashes from base', () => {
    expect(publicPageUrl('s', 'https://example.com/')).toBe('https://example.com/p/s');
  });
});
