import { describe, it, expect, vi } from 'vitest';
import {
  batchTurnsForTranslation,
  buildTranslationPrompt,
  parseTranslationResponse,
  translateEpisodeTurns,
  type TranslateTurnInput,
} from '@/lib/transcription/translation';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const turns: TranslateTurnInput[] = Array.from({ length: 90 }, (_, i) => ({
  turnId: `t${i}`,
  turnIndex: i,
  text: `line ${i}`,
}));

describe('batchTurnsForTranslation', () => {
  it('chunks turns into groups of chunkSize', () => {
    const batches = batchTurnsForTranslation(turns, 40);
    expect(batches).toHaveLength(3); // 40 + 40 + 10
    expect(batches[0]).toHaveLength(40);
    expect(batches[2]).toHaveLength(10);
  });

  it('returns empty for empty input', () => {
    expect(batchTurnsForTranslation([])).toEqual([]);
  });

  it('defaults chunkSize to 40', () => {
    expect(batchTurnsForTranslation(turns).length).toBe(3);
  });
});

describe('buildTranslationPrompt', () => {
  it('targets Chinese and includes the turn body', () => {
    const prompt = buildTranslationPrompt(turns.slice(0, 2), 'zh');
    expect(prompt).toContain('中文');
    expect(prompt).toContain('0\tline 0');
    expect(prompt).toContain('JSON');
  });

  it('targets English when target is en', () => {
    expect(buildTranslationPrompt(turns.slice(0, 1), 'en')).toContain('英文');
  });
});

describe('parseTranslationResponse', () => {
  it('parses clean JSON', () => {
    expect(parseTranslationResponse('{"translations": {"1": "你好"}}')).toEqual({ '1': '你好' });
  });

  it('parses fenced JSON', () => {
    expect(parseTranslationResponse('```json\n{"translations": {"0": "a"}}\n```')).toEqual({ '0': 'a' });
  });

  it('returns empty map on garbage', () => {
    expect(parseTranslationResponse('nope')).toEqual({});
  });
});

describe('translateEpisodeTurns', () => {
  const fakeClient = {
    completeWithRetry: vi.fn(),
  };

  it('skips turns already translated into the target language', async () => {
    const result = await translateEpisodeTurns({
      conversationId: 'c1',
      target: 'zh',
      turns: [{ turnId: 't0', turnIndex: 0, text: 'hi' }],
      existing: new Map([['t0', { zh: '你好' }]]),
      client: fakeClient as never,
      persist: vi.fn(),
    });
    expect(result.translatedCount).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(fakeClient.completeWithRetry).not.toHaveBeenCalled();
  });

  it('translates, merges with existing, and persists', async () => {
    fakeClient.completeWithRetry.mockResolvedValue({
      content: '{"translations": {"0": "你好"}}',
      usage: { inputTokens: 100_000, outputTokens: 50_000 }, // large enough to clear the round
    });
    const persist = vi.fn();

    const result = await translateEpisodeTurns({
      conversationId: 'c1',
      target: 'zh',
      turns: [{ turnId: 't0', turnIndex: 0, text: 'hi' }],
      existing: new Map([['t0', { ja: 'こんにちは' }]]), // merge with existing lang
      client: fakeClient as never,
      persist,
    });

    expect(result.translatedCount).toBe(1);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(persist).toHaveBeenCalledTimes(1);
    const persisted = persist.mock.calls[0][0][0];
    expect(persisted.translationJson).toEqual({ ja: 'こんにちは', zh: '你好' });
  });

  it('continues on a failed batch without throwing', async () => {
    fakeClient.completeWithRetry.mockRejectedValue(new Error('model down'));
    const persist = vi.fn();

    const result = await translateEpisodeTurns({
      conversationId: 'c1',
      target: 'zh',
      turns: [{ turnId: 't0', turnIndex: 0, text: 'hi' }],
      existing: new Map(),
      client: fakeClient as never,
      persist,
    });

    expect(result.translatedCount).toBe(0);
    expect(persist).not.toHaveBeenCalled();
  });
});
