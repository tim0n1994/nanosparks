import { describe, it, expect, vi } from 'vitest';
import { logger } from '@/lib/logger';
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

describe('runCorrectionPass — bounded batches', () => {
  const usage = { inputTokens: 100_000, outputTokens: 50_000 };
  const manyTurns = (count: number, text = 'gpt4 example'): CorrectionInput[] =>
    Array.from({ length: count }, (_, i) => ({ turnIndex: 1000 + i, speakerLabel: 'host', text }));

  it('bounds the actual prompt including glossary and entities without losing text', async () => {
    const input = manyTurns(10, 'A'.repeat(1500));
    const glossary = { terms: { wrong: 'right'.repeat(120) }, entities: ['entity'.repeat(80)] };
    const client = { completeWithRetry: vi.fn().mockResolvedValue({ content: '{"corrections":{}}', usage }) };
    const result = await runCorrectionPass(input, client as never, glossary);
    expect(client.completeWithRetry.mock.calls.length).toBeGreaterThan(1);
    const seen: number[] = [];
    for (const [messages, , attempts] of client.completeWithRetry.mock.calls) {
      const prompt = messages[0].content as string;
      expect(prompt.length).toBeLessThanOrEqual(6000);
      expect(attempts).toBe(1);
      for (const match of prompt.matchAll(/^(\d+)\thost\t(A+)$/gm)) {
        seen.push(Number(match[1]));
        expect(match[2]).toHaveLength(1500);
      }
    }
    expect(seen).toEqual(input.map((turn) => turn.turnIndex));
    expect(result.outputs.map((turn) => turn.text)).toEqual(input.map((turn) => turn.text));
  });

  it('also limits short-turn count and awaits each batch before starting the next', async () => {
    let resolveFirst!: (value: unknown) => void;
    const client = { completeWithRetry: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ content: '{"corrections":{}}', usage }) };
    const pending = runCorrectionPass(manyTurns(49), client as never);
    await Promise.resolve();
    expect(client.completeWithRetry).toHaveBeenCalledTimes(1);
    resolveFirst({ content: '{"corrections":{}}', usage });
    const result = await pending;
    expect(client.completeWithRetry).toHaveBeenCalledTimes(3);
    for (const [messages] of client.completeWithRetry.mock.calls) {
      expect((messages[0].content.match(/^\d+\thost\t/gm) ?? []).length).toBeLessThanOrEqual(24);
    }
    expect(result.outputs).toHaveLength(49);
  });

  it('keeps successful batches, degrades a failed batch, and rejects cross-batch corrections', async () => {
    const client = { completeWithRetry: vi.fn()
      .mockResolvedValueOnce({ content: '{"corrections":{"1000":"first corrected","1024":"outside batch"}}', usage })
      .mockRejectedValueOnce(new Error('batch unavailable'))
      .mockResolvedValueOnce({ content: '{"corrections":{"1048":"last corrected","1000":"overwrite first"}}', usage }) };
    const input = manyTurns(49);
    const result = await runCorrectionPass(input, client as never, { terms: { gpt4: 'GPT-4' } });
    expect(result.outputs.map((turn) => turn.turnIndex)).toEqual(input.map((turn) => turn.turnIndex));
    expect(result.outputs[0].text).toBe('first corrected');
    expect(result.outputs[24].text).toBe('GPT-4 example');
    expect(result.outputs[48].text).toBe('last corrected');
    expect(result.costUsd).toBeCloseTo(0.056);
  });

  it('logs and preserves an oversized turn with glossary fallback while correcting its neighbors', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const input = manyTurns(3);
    input[1].text = 'gpt4 ' + 'x'.repeat(7000);
    const client = { completeWithRetry: vi.fn().mockResolvedValue({ content: '{"corrections":{"1000":"first","1002":"last"}}', usage }) };
    const result = await runCorrectionPass(input, client as never, { terms: { gpt4: 'GPT-4' } });
    expect(client.completeWithRetry).toHaveBeenCalledTimes(2);
    expect(result.outputs[0].text).toBe('first');
    expect(result.outputs[1].text).toBe('GPT-4 ' + 'x'.repeat(7000));
    expect(result.outputs[2].text).toBe('last');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('budget'), expect.objectContaining({ turnIndex: 1001 }));
    warn.mockRestore();
  });

  it('extracts entities once and accumulates entity and batch costs', async () => {
    const client = { completeWithRetry: vi.fn()
      .mockResolvedValueOnce({ content: '{"entities":["OpenAI"]}', usage })
      .mockResolvedValue({ content: '{"corrections":{}}', usage }) };
    const result = await runCorrectionPass(manyTurns(49), client as never, {}, { title: 'A podcast' });
    expect(client.completeWithRetry).toHaveBeenCalledTimes(4);
    for (const [messages] of client.completeWithRetry.mock.calls.slice(1)) {
      expect(messages[0].content).toContain('【已知实体】OpenAI');
    }
    expect(result.costUsd).toBeCloseTo(0.112);
  });

  it('ignores invalid or blank model values without losing glossary output', async () => {
    const client = { completeWithRetry: vi.fn().mockResolvedValue({ content: '{"corrections":{"1000":123,"1001":"  "}}', usage }) };
    const result = await runCorrectionPass(manyTurns(2), client as never, { terms: { gpt4: 'GPT-4' } });
    expect(result.outputs.map((turn) => turn.text)).toEqual(['GPT-4 example', 'GPT-4 example']);
  });

  it('does not send oversized shared context or metadata to the model', async () => {
    const client = { completeWithRetry: vi.fn().mockResolvedValue({ content: '{"corrections":{}}', usage }) };
    const input = manyTurns(2);
    const result = await runCorrectionPass(input, client as never, { entities: ['x'.repeat(6000)] });
    expect(client.completeWithRetry).not.toHaveBeenCalled();
    expect(result.outputs.map((turn) => turn.text)).toEqual(input.map((turn) => turn.text));
    await runCorrectionPass(input, client as never, {}, { title: 'x'.repeat(6000) });
    expect(client.completeWithRetry).toHaveBeenCalledTimes(1);
    expect(client.completeWithRetry.mock.calls[0][0][0].content.length).toBeLessThanOrEqual(6000);
  });
});

describe('runCorrectionPass — fixed-time turn boundaries', () => {
  const correct = async (texts: string[], replacements: Record<string, string>, glossary = {}) => {
    const input = texts.map((text, turnIndex) => ({ turnIndex, text, speakerLabel: 'host' }));
    const client = { completeWithRetry: vi.fn().mockResolvedValue({ content: JSON.stringify({ corrections: replacements }), usage: { inputTokens: 100, outputTokens: 50 } }) };
    return runCorrectionPass(input, client as never, glossary);
  };

  it('rejects the observed apocalyptic transfer from the next turn', async () => {
    const texts = ['would say to become both excessively utopian and excessively', "apocalyptic Having said that I think what's actually"];
    const result = await correct(texts, { 0: texts[0] + ' apocalyptic', 1: "Having said that I think what's actually" });
    expect(result.outputs.map((turn) => turn.text)).toEqual(texts);
  });

  it('rejects a multiword transfer to the next turn and retains glossary fallback', async () => {
    const result = await correct(['gpt4 supports artificial intelligence', 'will change things'], {
      0: 'GPT-4 supports.', 1: 'Artificial intelligence will change things.',
    }, { terms: { gpt4: 'GPT-4' } });
    expect(result.outputs.map((turn) => turn.text)).toEqual(['GPT-4 supports artificial intelligence', 'will change things']);
    expect(result.outputs[0].corrections).toBe(1);
  });

  it('checks neighboring candidates across batch boundaries while keeping unrelated corrections', async () => {
    const texts = Array.from({ length: 25 }, (_, i) => `Original line ${i}`);
    texts[23] = 'We are discussing';
    texts[24] = 'artificial intelligence in detail';
    const result = await correct(texts, { 0: 'Original line zero.', 23: 'We are discussing artificial intelligence.', 24: 'In detail.' });
    expect(result.outputs[0].text).toBe('Original line zero.');
    expect(result.outputs[23].text).toBe(texts[23]);
    expect(result.outputs[24].text).toBe(texts[24]);
  });

  it('allows ordinary glossary, entity, punctuation and filler corrections', async () => {
    const result = await correct(['um gpt4 supports artificial intelligence', 'Sam Alman works there'], {
      0: 'GPT-4 supports artificial intelligence.', 1: 'Sam Altman works there.',
    }, { terms: { gpt4: 'GPT-4' }, entities: ['Sam Altman'] });
    expect(result.outputs.map((turn) => turn.text)).toEqual(['GPT-4 supports artificial intelligence.', 'Sam Altman works there.']);
  });

  it('does not mistake adjacent name replacements for a boundary transfer', async () => {
    const result = await correct(['I spoke to Sam Alman', 'Sam Altman explained it'], {
      0: 'I spoke to Sam Altman.', 1: 'Samuel Altman explained it.',
    }, { entities: ['Sam Altman', 'Samuel Altman'] });
    expect(result.outputs.map((turn) => turn.text)).toEqual(['I spoke to Sam Altman.', 'Samuel Altman explained it.']);
  });

  it('rejects Chinese boundary movement while ignoring punctuation', async () => {
    const texts = ['我们讨论人工智能', '将如何改变世界'];
    const result = await correct(texts, { 0: '我们讨论，', 1: '人工智能将如何改变世界。' });
    expect(result.outputs.map((turn) => turn.text)).toEqual(texts);
  });

  it('detects both boundaries in a three-turn transfer before reverting candidates', async () => {
    const texts = ['start alpha', 'beta gamma', 'delta end'];
    const result = await correct(texts, { 0: 'start', 1: 'alpha beta', 2: 'gamma delta end' });
    expect(result.outputs.map((turn) => turn.text)).toEqual(texts);
  });
});
