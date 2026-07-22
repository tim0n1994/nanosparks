import { describe, it, expect } from 'vitest';
import {
  declarationGuideFor,
  buildWechatSegments,
  buildXiaohongshuSegments,
  buildZhihuSegments,
  buildExportBundle,
  buildAigcXmp,
} from '@/lib/publish/channels';
import type { GeneratedCopy } from '@/lib/publish/copy';

const copy: GeneratedCopy = {
  platform: 'xiaohongshu',
  variant: 'quote',
  title: '标题',
  body: '第一段\n\n第二段',
  tags: ['播客', '解读'],
  sourceAttribution: '🎙️来源：《节目》EP.1',
};

describe('declarationGuideFor', () => {
  it('returns platform-specific guidance for every platform', () => {
    expect(declarationGuideFor('xiaohongshu')).toContain('内容类型声明');
    expect(declarationGuideFor('wechat')).toContain('AI');
    expect(declarationGuideFor('zhihu')).toContain('AI');
  });
});

describe('buildWechatSegments', () => {
  it('produces a title + HTML body with whitelisted tags only', () => {
    const segs = buildWechatSegments(copy);
    expect(segs[0]).toEqual({ label: '标题', text: '标题', flavor: 'text/plain' });
    expect(segs[1].flavor).toBe('text/html');
    expect(segs[1].text).toContain('<p>');
    expect(segs[1].text).toContain('</p>');
  });

  it('escapes HTML in the body to prevent injection', () => {
    const segs = buildWechatSegments({ ...copy, body: '<script>x</script>' });
    expect(segs[1].text).not.toContain('<script>');
    expect(segs[1].text).toContain('&lt;script&gt;');
  });
});

describe('buildXiaohongshuSegments', () => {
  it('splits title / body / tags into separate paste segments', () => {
    const segs = buildXiaohongshuSegments(copy);
    expect(segs.map((s) => s.label)).toEqual(['标题', '正文', 'tags']);
    expect(segs[2].text).toBe('#播客 #解读');
  });

  it('omits the tags segment when there are none', () => {
    const segs = buildXiaohongshuSegments({ ...copy, tags: undefined });
    expect(segs.find((s) => s.label === 'tags')).toBeUndefined();
  });
});

describe('buildZhihuSegments', () => {
  it('produces title + body plain-text segments', () => {
    const segs = buildZhihuSegments(copy);
    expect(segs.map((s) => s.flavor)).toEqual(['text/plain', 'text/plain']);
  });
});

describe('buildExportBundle', () => {
  it('assembles platform segments + declaration guide + cards', () => {
    const bundle = buildExportBundle('xiaohongshu', copy, []);
    expect(bundle.platform).toBe('xiaohongshu');
    expect(bundle.clipboardSegments.length).toBeGreaterThan(0);
    expect(bundle.declarationGuide).toContain('内容类型声明');
  });
});

describe('buildAigcXmp', () => {
  it('embeds provider code, content id, and isAigc flag', () => {
    const xmp = buildAigcXmp({
      providerCode: 'NSP001',
      contentId: 'pkg_abc',
      generatedAt: '2026-07-22T10:00:00Z',
    });
    expect(xmp).toContain('NSP001');
    expect(xmp).toContain('pkg_abc');
    expect(xmp).toContain('<aigc:isAigc>true</aigc:isAigc>');
  });

  it('escapes special chars in label fields', () => {
    const xmp = buildAigcXmp({
      providerCode: '<x>',
      contentId: 'a&b',
      generatedAt: '2026',
    });
    expect(xmp).not.toContain('<x>');
    expect(xmp).toContain('&lt;x&gt;');
    expect(xmp).toContain('a&amp;b');
  });
});
