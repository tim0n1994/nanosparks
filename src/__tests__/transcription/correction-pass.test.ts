import { describe, it, expect, vi } from 'vitest';
import {
  applyGlossaryPass,
  parseCorrectionResponse,
  buildCorrectionPrompt,
  runCorrectionPass,
  type CorrectionInput,
} from '@/lib/transcription/correction-pass';

const turns: CorrectionInput[] = [
  { turnIndex: 0, speakerLabel: 'speaker_0', text: '今天聊聊openai的最新进展' },
  { turnIndex: 1, speakerLabel: 'speaker_0', text: '那个，然后，就是 gpt4 很强' },
];

describe('applyGlossaryPass', () => {
  it('substitutes glossary terms deterministically without LLM', () => {
    const out = applyGlossaryPass(turns, { terms: { openai: 'OpenAI', gpt4: 'GPT-4' } });
    expect(out[0].text).toBe('今天聊聊OpenAI的最新进展');
    expect(out[1].text).toBe('那个，然后，就是 GPT-4 很强');
    expect(out[0].corrections).toBeGreaterThan(0);
  });

  it('leaves turns untouched when no glossary hits', () => {
    const out = applyGlossaryPass(turns, { terms: { nonexistentterm: 'X' } });
    expect(out[0].text).toBe(turns[0].text);
    expect(out[0].corrections).toBe(0);
  });

  it('handles empty glossary', () => {
    const out = applyGlossaryPass(turns, {});
    expect(out.map((t) => t.text)).toEqual(turns.map((t) => t.text));
  });
});

describe('parseCorrectionResponse', () => {
  it('parses a clean JSON object', () => {
    const map = parseCorrectionResponse('{"corrections": {"1": "修正后"}}');
    expect(map).toEqual({ '1': '修正后' });
  });

  it('parses JSON wrapped in code fences', () => {
    const map = parseCorrectionResponse('```json\n{"corrections": {"0": "a"}}\n```');
    expect(map).toEqual({ '0': 'a' });
  });

  it('parses JSON embedded in prose', () => {
    const map = parseCorrectionResponse('好的，结果如下：\n{"corrections": {"2": "b"}}\n以上。');
    expect(map).toEqual({ '2': 'b' });
  });

  it('returns empty map on unparseable input', () => {
    expect(parseCorrectionResponse('not json at all')).toEqual({});
    expect(parseCorrectionResponse('')).toEqual({});
  });
});

describe('buildCorrectionPrompt', () => {
  it('includes the glossary terms and turn body', () => {
    const prompt = buildCorrectionPrompt(turns, { terms: { openai: 'OpenAI' } });
    expect(prompt).toContain('OpenAI');
    expect(prompt).toContain('0\tspeaker_0');
    expect(prompt).toContain('JSON');
  });

  it('omits the glossary section when empty', () => {
    const prompt = buildCorrectionPrompt(turns, {});
    // The instruction mentions 术语词典 in general, but the glossary TABLE
    // line ('术语词典（严格按此纠正') must be absent when none is provided.
    expect(prompt).not.toContain('术语词典（严格按此纠正');
  });
});

describe('runCorrectionPass', () => {
  it('merges LLM corrections over glossary results', async () => {
    const fakeClient = {
      completeWithRetry: vi.fn().mockResolvedValue({
        content: '{"corrections": {"0": "今天聊聊 OpenAI 的最新进展"}}',
        usage: { inputTokens: 100_000, outputTokens: 50_000 },
      }),
    };
    const result = await runCorrectionPass(turns, fakeClient as never, { terms: { openai: 'OpenAI' } });
    expect(result.outputs[0].text).toBe('今天聊聊 OpenAI 的最新进展');
    expect(result.outputs[0].corrections).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('falls back to glossary-only when the LLM fails', async () => {
    const fakeClient = {
      completeWithRetry: vi.fn().mockRejectedValue(new Error('model down')),
    };
    const result = await runCorrectionPass(turns, fakeClient as never, { terms: { openai: 'OpenAI' } });
    expect(result.outputs[0].text).toBe('今天聊聊OpenAI的最新进展');
    expect(result.costUsd).toBe(0); // LLM failed → no cost
  });

  it('returns empty for empty turns', async () => {
    const fakeClient = { completeWithRetry: vi.fn() };
    const result = await runCorrectionPass([], fakeClient as never);
    expect(result.outputs).toEqual([]);
    expect(result.costUsd).toBe(0);
    expect(fakeClient.completeWithRetry).not.toHaveBeenCalled();
  });
});

describe('buildCorrectionPrompt — entity section', () => {
  it('includes known entities and the 4th rule when entities present', () => {
    const prompt = buildCorrectionPrompt(turns, { entities: ['Physical Intelligence', '柯丽一鸣'] });
    expect(prompt).toContain('【已知实体】');
    expect(prompt).toContain('Physical Intelligence');
    expect(prompt).toContain('柯丽一鸣');
    expect(prompt).toContain('实体校正');
  });

  it('omits entity section and 4th rule when no entities', () => {
    const prompt = buildCorrectionPrompt(turns, {});
    expect(prompt).not.toContain('【已知实体】');
    expect(prompt).not.toContain('实体校正');
  });
});

describe('runCorrectionPass — metadata entity extraction', () => {
  it('extracts entities then uses them in the correction prompt', async () => {
    // First call = entity extraction, second = correction.
    const fakeClient = {
      completeWithRetry: vi.fn()
        .mockResolvedValueOnce({
          content: '{"entities": ["Physical Intelligence", "柯丽一鸣"]}',
          usage: { inputTokens: 200, outputTokens: 30 },
        })
        .mockResolvedValueOnce({
          content: '{"corrections": {"0": "今天聊聊 Physical Intelligence 的柯丽一鸣"}}',
          usage: { inputTokens: 100_000, outputTokens: 50_000 },
        }),
    };
    const result = await runCorrectionPass(turns, fakeClient as never, {}, {
      title: '和Pi研究员柯丽一鸣聊机器人',
      description: 'Physical Intelligence 是一家机器人公司',
    });
    // Two LLM calls: extract + correct.
    expect(fakeClient.completeWithRetry).toHaveBeenCalledTimes(2);
    // The correction prompt (2nd call) should contain the extracted entities.
    const correctPrompt = fakeClient.completeWithRetry.mock.calls[1][0][0].content;
    expect(correctPrompt).toContain('Physical Intelligence');
    expect(correctPrompt).toContain('柯丽一鸣');
    // LLM correction applied.
    expect(result.outputs[0].text).toContain('Physical Intelligence');
  });

  it('degrades gracefully when entity extraction fails', async () => {
    // Entity extraction throws, correction still runs with 3-rule pass.
    const fakeClient = {
      completeWithRetry: vi.fn()
        .mockRejectedValueOnce(new Error('extract failed'))
        .mockResolvedValueOnce({
          content: '{"corrections": {"0": "corrected anyway"}}',
          usage: { inputTokens: 100, outputTokens: 50 },
        }),
    };
    const result = await runCorrectionPass(turns, fakeClient as never, {}, {
      title: 'Some title',
    });
    // Correction still happened (fallback to 3 rules, no entities).
    expect(result.outputs[0].text).toBe('corrected anyway');
  });

  it('skips entity extraction when no metadata provided', async () => {
    const fakeClient = {
      completeWithRetry: vi.fn().mockResolvedValue({
        content: '{"corrections": {"0": "ok"}}',
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    };
    await runCorrectionPass(turns, fakeClient as never);
    // Only one call (correction), no entity extraction.
    expect(fakeClient.completeWithRetry).toHaveBeenCalledTimes(1);
  });
});
