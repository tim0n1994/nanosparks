/**
 * Publish channels (B2) — PRD §B2 发布通道.
 *
 * Per PRD ADR #3: we are a "content-pack generator" not an "auto-publisher".
 * Only WeChat (认证服务号) has an official direct API. 小红书/知乎 are export-only
 * (download assets + segmented copy-to-clipboard) because they have no publish
 * API and RPA risks bans.
 */

import type { AigcLabel, RenderedCard } from './types';
import type { Platform, GeneratedCopy } from './copy';

/** What a channel produces for the user to act on. */
export interface ExportBundle {
  platform: Platform;
  copy: GeneratedCopy;
  cards: RenderedCard[];
  clipboardSegments: ClipboardSegment[];
  wechatDraft?: { mediaIds: string[]; draftId?: string };
  declarationGuide: string;
}

export interface ClipboardSegment {
  label: string;
  text: string;
  flavor: 'text/plain' | 'text/html';
}

/** AI-content declaration guidance per platform (PRD §B2). */
export function declarationGuideFor(platform: Platform): string {
  switch (platform) {
    case 'xiaohongshu':
      return '小红书：设置 → 内容类型声明 → 勾选"笔记含 AI 合成内容"。未声明被强制打标/限流。';
    case 'wechat':
      return '公众号：发文时在编辑器勾选"由 AI 生成"。导出的图片已写入 AIGC 隐式标识。';
    case 'zhihu':
      return '知乎：发布时在内容声明中选择"包含 AI 生成内容"。';
  }
}

/** Build WeChat copy segments (rich HTML paste for the editor). */
export function buildWechatSegments(copy: GeneratedCopy): ClipboardSegment[] {
  return [
    { label: '标题', text: copy.title, flavor: 'text/plain' },
    { label: '正文（HTML）', text: wechatHtml(copy), flavor: 'text/html' },
  ];
}

/** Build 小红书 copy segments (title / body / tags split for one-tap paste). */
export function buildXiaohongshuSegments(copy: GeneratedCopy): ClipboardSegment[] {
  const segs: ClipboardSegment[] = [
    { label: '标题', text: copy.title, flavor: 'text/plain' },
    { label: '正文', text: copy.body, flavor: 'text/plain' },
  ];
  if (copy.tags && copy.tags.length > 0) {
    segs.push({ label: 'tags', text: copy.tags.map((t) => `#${t}`).join(' '), flavor: 'text/plain' });
  }
  return segs;
}

/** Build 知乎 copy segments. */
export function buildZhihuSegments(copy: GeneratedCopy): ClipboardSegment[] {
  return [
    { label: '标题', text: copy.title, flavor: 'text/plain' },
    { label: '正文', text: copy.body, flavor: 'text/plain' },
  ];
}

/** Inline-style HTML whitelist: strong / em / blockquote / p only (PRD hard rule). */
function wechatHtml(copy: GeneratedCopy): string {
  const safe = escapeHtml(copy.body);
  return `<p>${safe.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Assemble a full export bundle for a platform + copy + rendered cards. */
export function buildExportBundle(
  platform: Platform,
  copy: GeneratedCopy,
  cards: RenderedCard[],
  wechatDraft?: { mediaIds: string[]; draftId?: string },
): ExportBundle {
  const clipboardSegments =
    platform === 'wechat' ? buildWechatSegments(copy) :
    platform === 'xiaohongshu' ? buildXiaohongshuSegments(copy) :
    buildZhihuSegments(copy);

  return {
    platform,
    copy,
    cards,
    clipboardSegments,
    wechatDraft,
    declarationGuide: declarationGuideFor(platform),
  };
}

/**
 * Compose the AIGC implicit-label XMP packet to write into exported PNG metadata
 * (PRD §8/§B1 标识办法第五条). Returns the raw XMP XML string the renderer embeds.
 */
export function buildAigcXmp(label: AigcLabel): string {
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about=""',
    '      xmlns:aigc="https://ns.nanosparks.dev/aigc/1.0/">',
    `      <aigc:providerCode>${escapeHtml(label.providerCode)}</aigc:providerCode>`,
    `      <aigc:contentId>${escapeHtml(label.contentId)}</aigc:contentId>`,
    `      <aigc:generatedAt>${escapeHtml(label.generatedAt)}</aigc:generatedAt>`,
    '      <aigc:isAigc>true</aigc:isAigc>',
    '    </rdf:Description>',
    '  </rdf:RDF>',
    '</x:xmpmeta>',
  ].join('\n');
}
