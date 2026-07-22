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
