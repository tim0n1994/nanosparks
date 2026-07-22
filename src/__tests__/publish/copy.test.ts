import { describe, it, expect } from 'vitest';
import {
  buildXiaohongshuPrompt,
  buildWechatPrompt,
  buildZhihuPrompt,
  sourceLine,
  parseCopyResponse,
  validateXiaohongshu,
  validateWechatDigest,
} from '@/lib/publish/copy';

const input = {
  episodeTitle: '好奇心与创造力',
  showTitle: '思想火花',
  episodeNumber: '42',
  quotes: [{ id: 'q1', text: '好奇心是最好的天赋' }],
  keyPoints: [
    { id: 'k1', text: '保持开放心态' },
    { id: 'k2', text: '跨领域连接' },
  ],
  sourceUrl: 'https://example.com/ep',
};

describe('sourceLine', () => {
  it('builds the fixed attribution with show + episode number', () => {
    expect(sourceLine(input)).toBe('🎙️来源：《思想火花》EP.42');
  });

  it('falls back to episode title when no show title', () => {
    expect(sourceLine({ ...input, showTitle: undefined })).toBe('🎙️来源：《好奇心与创造力》EP.42');
  });
});

describe('buildXiaohongshuPrompt', () => {
  const prompt = buildXiaohongshuPrompt(input, 'quote');

  it('includes the hard rules and structural constraints', () => {
    expect(prompt).toContain('≤20 字');
    expect(prompt).toContain('≤1000 字');
    expect(prompt).toContain('tags 5-8');
  });

  it('embeds the fixed source line', () => {
    expect(prompt).toContain('🎙️来源：《思想火花》EP.42');
  });

  it('includes the quotes and key points material', () => {
    expect(prompt).toContain('好奇心是最好的天赋');
    expect(prompt).toContain('保持开放心态');
  });

  it('varies the variant hint', () => {
    expect(buildXiaohongshuPrompt(input, 'list')).toContain('清单版');
    expect(buildXiaohongshuPrompt(input, 'controversy')).toContain('争议观点版');
  });

  it('forbids sensitive categories', () => {
    expect(prompt).toContain('医疗');
    expect(prompt).toContain('绝对化');
    expect(prompt).toContain('引流词');
  });
});

describe('buildWechatPrompt', () => {
  const prompt = buildWechatPrompt(input);

  it('enforces digest length and structure', () => {
    expect(prompt).toContain('digest ≤120 字');
    expect(prompt).toContain('小标题分节');
  });

  it('requests the content source url placeholder', () => {
    expect(prompt).toContain('content_source_url');
  });
});

describe('buildZhihuPrompt', () => {
  it('produces an article prompt', () => {
    const p = buildZhihuPrompt(input, 'article');
    expect(p).toContain('文章');
    expect(p).toContain('sections');
  });

  it('produces an answer prompt with conclusion-first', () => {
    const p = buildZhihuPrompt(input, 'answer');
    expect(p).toContain('回答');
    expect(p).toContain('结论先行');
  });
});

describe('parseCopyResponse', () => {
  it('parses clean JSON', () => {
    expect(parseCopyResponse('{"title":"x","body":"y"}')).toEqual({ title: 'x', body: 'y' });
  });

  it('parses fenced JSON', () => {
    expect(parseCopyResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('returns null on garbage', () => {
    expect(parseCopyResponse('not json')).toBeNull();
  });
});

describe('validators', () => {
  it('flags oversized 小红书 title/body/tag counts', () => {
    expect(validateXiaohongshu({ title: 'a'.repeat(25), body: 'b' })).toContainEqual(expect.stringContaining('标题'));
    expect(validateXiaohongshu({ title: 't', body: 'a'.repeat(1001) })).toContainEqual(expect.stringContaining('正文'));
    expect(validateXiaohongshu({ title: 't', body: 'b', tags: ['a', 'b'] })).toContainEqual(expect.stringContaining('tags'));
  });

  it('passes valid 小红书 copy', () => {
    expect(validateXiaohongshu({ title: '短标题', body: '正文', tags: ['1', '2', '3', '4', '5'] })).toEqual([]);
  });

  it('flags an over-length 公众号 digest', () => {
    expect(validateWechatDigest('a'.repeat(121))).toContainEqual(expect.stringContaining('120 字'));
    expect(validateWechatDigest('短摘要')).toEqual([]);
  });
});
