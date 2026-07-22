import { describe, it, expect } from 'vitest';
import { conversationToMarkdown, exportFilename } from '@/lib/export/markdown';

const input = {
  title: '好奇心与创造力',
  showTitle: '思想火花',
  sourceUrl: 'https://example.com/ep',
  durationSec: 3600,
  platform: 'xiaoyuzhou',
  participants: [
    { name: '主播', speakerLabel: 'speaker_0', role: 'host' },
    { name: '嘉宾', speakerLabel: 'speaker_1', role: null },
  ],
  tldr: [{ type: 'insight', text: '保持好奇' }],
  quotes: [{ type: 'insight', text: '好奇心是天赋' }],
  turns: [
    { turnIndex: 0, startMs: 1000, endMs: 2000, text: '大家好', speakerName: '主播', speakerLabel: 'speaker_0' },
  ],
};

describe('conversationToMarkdown', () => {
  const md = conversationToMarkdown(input);

  it('emits YAML frontmatter delimited by ---', () => {
    expect(md.startsWith('---\n')).toBe(true);
    expect(md.slice(3)).toContain('\n---');
  });

  it('includes title, show, platform in frontmatter', () => {
    expect(md).toContain('title: 好奇心与创造力');
    expect(md).toContain('show: 思想火花');
    expect(md).toContain('platform: xiaoyuzhou');
  });

  it('renders the H1 title and show italic', () => {
    expect(md).toContain('# 好奇心与创造力');
    expect(md).toContain('*《思想火花》*');
  });

  it('renders TL;DR and 金句 sections', () => {
    expect(md).toContain('## TL;DR');
    expect(md).toContain('- 保持好奇');
    expect(md).toContain('## 金句');
    expect(md).toContain('> 好奇心是天赋');
  });

  it('renders the participant roster with roles and labels', () => {
    expect(md).toContain('## 说话人');
    expect(md).toContain('**主播** (host) `speaker_0`');
    expect(md).toContain('**嘉宾** `speaker_1`');
  });

  it('renders timestamped transcript', () => {
    expect(md).toContain('## 全文');
    expect(md).toContain('**主播** `0:01`');
    expect(md).toContain('大家好');
  });

  it('quotes YAML values containing special characters', () => {
    const out = conversationToMarkdown({ ...input, title: 'A: B "C" #D' });
    expect(out).toContain('title: "A: B \\"C\\" #D"');
  });

  it('includes the source link at the end', () => {
    expect(md).toContain('[原链接](https://example.com/ep)');
  });

  it('handles empty turns/tldr/quotes gracefully', () => {
    const out = conversationToMarkdown({ ...input, tldr: [], quotes: [], turns: [], participants: [] });
    expect(out).not.toContain('## TL;DR');
    expect(out).not.toContain('## 金句');
    expect(out).not.toContain('## 说话人');
  });
});

describe('exportFilename', () => {
  it('builds a .md filename from the title', () => {
    expect(exportFilename('Hello World')).toBe('Hello_World.md');
  });

  it('strips unsafe characters and keeps CJK', () => {
    // Unsafe chars (/:?) stripped; CJK retained; .md appended.
    expect(exportFilename('好奇心/创造:力?')).toBe('好奇心创造力.md');
  });

  it('falls back to episode for empty titles', () => {
    expect(exportFilename('')).toBe('episode.md');
  });
});
