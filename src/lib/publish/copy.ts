/**
 * Per-platform copy generation (B1) — PRD §B1 文案生成规格.
 *
 * Each platform gets its own prompt builder enforcing the structural constraints
 * and hard rules from the PRD table. Output is structured JSON so the caller can
 * persist it in PublishPackage.copyText and run the sensitive-word filter before
 * surfacing to the user.
 */

import type { ThoughtUnitLike } from './types';

export type Platform = 'xiaohongshu' | 'wechat' | 'zhihu';
export type Variant = 'quote' | 'list' | 'controversy' | 'digest' | 'answer';

export interface GeneratedCopy {
  platform: Platform;
  variant: Variant;
  title: string;
  body: string;
  tags?: string[];
  sourceAttribution: string;
}

export interface CopyInput {
  episodeTitle: string;
  showTitle?: string;
  episodeNumber?: string;
  quotes: ThoughtUnitLike[];
  keyPoints: ThoughtUnitLike[];
  /** Original source URL for the backlink (copyright). */
  sourceUrl?: string;
}

/** Build the fixed source-attribution line (PRD hard rule for every platform). */
export function sourceLine(input: CopyInput): string {
  const ep = input.episodeNumber ? `EP.${input.episodeNumber}` : '';
  const name = input.showTitle || input.episodeTitle;
  return `🎙️来源：《${name}》${ep}`;
}

/**
 * 小红书 prompt (PRD §B1 table):
 * 标题 ≤20 字含钩子；正文 ≤1000 字；emoji 1-2/段；tags 5-8；是解读不是搬运。
 */
export function buildXiaohongshuPrompt(input: CopyInput, variant: Variant): string {
  const quotes = input.quotes.slice(0, 3).map((q) => `- ${q.text}`).join('\n');
  const points = input.keyPoints.slice(0, 5).map((p) => `- ${p.text}`).join('\n');
  const variantHint =
    variant === 'quote' ? '金句版（以 3 句最打动人的话为骨架）' :
    variant === 'list' ? '清单版（3-5 条干货要点）' :
    variant === 'controversy' ? '争议观点版（聚焦一个有分歧的判断）' :
    '导读版（一句话价值 + 3 要点）';

  return [
    '你是小红书爆款文案写手。基于下面这集播客的解读要点，生成一篇小红书笔记。',
    `版本：${variantHint}`,
    '硬规则：',
    '1) 标题 ≤20 字，必须含钩子（数字/悬念/身份代入之一）。',
    '2) 正文 ≤1000 字：共鸣开头 2 行 → 要点 3-5 条 → 互动提问结尾。',
    '3) 每段 emoji 1-2 个，不要堆砌。',
    '4) 这是解读不是搬运，不要照抄原文。',
    '5) 出处行固定为「' + sourceLine(input) + '」，放在文末。',
    '6) tags 5-8 个，垂类与泛流量混合。',
    '7) 严禁：医疗宣称、绝对化用语（最好/第一/100%）、引流词（加微信/私聊）。',
    '',
    '金句素材：',
    quotes || '（无）',
    '',
    '要点素材：',
    points || '（无）',
    '',
    '严格只输出 JSON：{"title": string, "body": string, "tags": string[]}',
  ].join('\n');
}

/**
 * 公众号 prompt (PRD §B1 table):
 * digest ≤120 字；小标题分节；金句用引用块+说话人；文末链接。
 */
export function buildWechatPrompt(input: CopyInput): string {
  const quotes = input.quotes.slice(0, 4).map((q, i) => `${i + 1}. "${q.text}"`).join('\n');
  const points = input.keyPoints.slice(0, 5).map((p, i) => `${i + 1}. ${p.text}`).join('\n');

  return [
    '你是公众号长文编辑。基于下面这集播客的解读，生成一篇公众号文章。',
    '结构：digest 导语 ≤120 字 → 3-4 个小标题分节 → 每节引用 1 句金句（用「」标注说话人）→ 文末"阅读全文文字版"链接。',
    '硬规则：',
    '1) digest ≤120 字。',
    '2) 小标题分节，每节聚焦一个论点。',
    '3) 金句用引用块格式，标注说话人。',
    '4) 文末加一行：阅读全文文字版：<链接>（先用占位 <content_source_url>）。',
    '5) HTML 内联样式白名单：仅 strong/em/blockquote/p。',
    '6) 出处行固定为「' + sourceLine(input) + '」。',
    '',
    '金句素材：',
    quotes || '（无）',
    '',
    '要点素材：',
    points || '（无）',
    '',
    '严格只输出 JSON：{"title": string, "digest": string, "sections": [{"heading": string, "body": string}], "contentSourceUrl": "<content_source_url>"}',
  ].join('\n');
}

/**
 * 知乎 prompt (PRD §B1 table): 文章版 + 回答版。回答版结论先行 + 论据 + 出处。
 */
export function buildZhihuPrompt(input: CopyInput, mode: 'article' | 'answer'): string {
  const quotes = input.quotes.slice(0, 3).map((q) => `- ${q.text}`).join('\n');
  const points = input.keyPoints.slice(0, 4).map((p) => `- ${p.text}`).join('\n');

  const articleRules = '文章版：导语 + 分节，每节一个论点。严格只输出 JSON：{"title": string, "intro": string, "sections": [{"heading": string, "body": string}]}';
  const answerRules = '回答版：结论先行（第一句即结论）→ 用播客论据支撑 → 每个论据带出处（说话人）。严格只输出 JSON：{"answer": string, "conclusion": string}';

  return [
    `你是知乎内容创作者。基于下面这集播客的解读，生成知乎${mode === 'article' ? '文章' : '回答'}。`,
    mode === 'article' ? articleRules : answerRules,
    '硬规则：',
    '1) 回答版蹭已有高热问题，结论先行。',
    '2) 论据来自播客，每个论据标注出处（说话人）。',
    '3) 出处行固定为「' + sourceLine(input) + '」。',
    '4) 严禁医疗/绝对化/引流词。',
    '',
    '金句素材：',
    quotes || '（无）',
    '',
    '要点素材：',
    points || '（无）',
  ].join('\n');
}

/** Parse the LLM JSON copy response (tolerant of code fences). */
export function parseCopyResponse(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Validate a 小红书 copy against the PRD constraints. */
export function validateXiaohongshu(copy: { title: string; body: string; tags?: string[] }): string[] {
  const issues: string[] = [];
  if (copy.title.length > 20) issues.push(`标题 ${copy.title.length} 字，超过 20 字上限`);
  if (copy.body.length > 1000) issues.push(`正文 ${copy.body.length} 字，超过 1000 字上限`);
  if (copy.tags && (copy.tags.length < 5 || copy.tags.length > 8)) {
    issues.push(`tags ${copy.tags.length} 个，应在 5-8 之间`);
  }
  return issues;
}

/** Validate a 公众号 digest length. */
export function validateWechatDigest(digest: string): string[] {
  const issues: string[] = [];
  if (digest.length > 120) issues.push(`digest ${digest.length} 字，超过 120 字上限`);
  return issues;
}
