import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OpenAIClient } from '@/lib/llm/client';
import { extractFromWindowReliable } from '@/lib/extraction/reliable-window';
import type { TranscriptWindow } from '@/lib/extraction/windowed-extraction';

// The reliability layer logs every retry/fallback via logger.warn; mock it to
// keep test output clean (the jsonl event log is asserted directly instead).
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const FIXTURE_DIR = path.join(process.cwd(), '.omo', 'evidence', '2026-10-21-iter3', 'fixtures');

interface Fixture {
  pairId: string;
  purpose: string;
  windowIndex: number;
  windowText: string;
  windowSource: { conversationId: string; conversationLabel: string; stratum: string; turnIndices: number[]; startMs: number; endMs: number; speakers: string[] };
  fastModel: string;
  autoModel: string;
  fastOutput: string;
  autoOutput: string;
  fastFinishReason: string;
  autoFinishReason: string;
  expectedReason: string | null;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Fixture;
}

function windowFromFixture(fx: Fixture): TranscriptWindow {
  return {
    index: fx.windowIndex,
    startMs: fx.windowSource.startMs,
    endMs: fx.windowSource.endMs,
    turnIndices: fx.windowSource.turnIndices,
    text: fx.windowText,
    speakers: fx.windowSource.speakers,
  };
}

interface ScriptedTurn {
  content: string;
  finish_reason: string;
}

/** Mock the LLM gateway: each fetch returns the next scripted OpenAI-shaped
 * response ({choices:[{message:{content}, finish_reason}]}, usage). The last
 * script entry repeats if the code under test calls more times than scripted. */
function installGateway(script: ScriptedTurn[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(url), body });
    const turn = script[Math.min(calls.length - 1, script.length - 1)];
    const payload = {
      id: `chatcmpl-${calls.length}`,
      object: 'chat.completion',
      model: body.model,
      choices: [
        { index: 0, message: { role: 'assistant', content: turn.content }, finish_reason: turn.finish_reason },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

function eventPathFor(name: string): string {
  const p = path.join(tmpdir(), `nsp-reliable-${name}.jsonl`);
  rmSync(p, { force: true });
  return p;
}

const textsOf = (result: { thoughtUnits: Array<{ text: string }> }) => result.thoughtUnits.map((tu) => tu.text);
const rawTexts = (output: string) => (JSON.parse(output) as { thoughtUnits: Array<{ text: string }> }).thoughtUnits.map((tu) => tu.text);

// Real iter2 blind-eval failures: P012 fast returned a parseable but completely
// empty extraction; P028 fast was cut mid-string by the token cap; P030 fast
// emitted unescaped inner quotes. P012-MF is the synthetic missing-field case
// (no thoughtUnits key; the zod default([]) must not mask it).
describe.each([
  ['P012-empty', 'empty'],
  ['P028-truncated', 'truncated'],
  ['P030-parse-fail', 'parse_fail'],
  ['P012-missing-field', 'missing_field'],
])('%s: bad → bad → auto good', (name, expectedReason) => {
  it('adopts the auto result and records retry + fallback events', async () => {
    const fx = loadFixture(name);
    expect(fx.expectedReason).toBe(expectedReason);
    const eventPath = eventPathFor(name);

    const fastClient = new OpenAIClient('test-key', fx.fastModel, 'http://127.0.0.1:9/v1');
    const autoClient = new OpenAIClient('test-key', fx.autoModel, 'http://127.0.0.1:9/v1');
    const { fetchMock, calls } = installGateway([
      { content: fx.fastOutput, finish_reason: fx.fastFinishReason },
      { content: fx.fastOutput, finish_reason: fx.fastFinishReason },
      { content: fx.autoOutput, finish_reason: fx.autoFinishReason },
    ]);

    const result = await extractFromWindowReliable(fastClient, windowFromFixture(fx), {
      model: fx.fastModel,
      conversationId: fx.windowSource.conversationId,
      fallbackModel: fx.autoModel,
      createFallbackClient: () => autoClient,
      eventLogPath: eventPath,
    });

    // The auto (fallback) result is adopted verbatim.
    expect(result.windowIndex).toBe(fx.windowIndex);
    expect(textsOf(result)).toEqual(rawTexts(fx.autoOutput));
    // Exactly 3 gateway calls: fast attempt, fast retry, auto fallback.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.body.model)).toEqual([fx.fastModel, fx.fastModel, fx.autoModel]);

    // Event chain: one retry + one fallback, both classified with the fixture's reason.
    const lines = readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      stage: 'retry',
      reason: expectedReason,
      model: fx.fastModel,
      fallbackModel: fx.autoModel,
      windowIndex: fx.windowIndex,
      conversationId: fx.windowSource.conversationId,
    });
    expect(lines[1]).toMatchObject({
      stage: 'fallback',
      reason: expectedReason,
      model: fx.fastModel,
      fallbackModel: fx.autoModel,
    });
    for (const line of lines) {
      expect(typeof line.ts).toBe('string');
      expect(Number.isNaN(Date.parse(line.ts as string))).toBe(false);
    }
  });
});

describe('reliable window extraction happy path', () => {
  it('returns the fast result on first success with no events', async () => {
    const fx = loadFixture('P002-good');
    const eventPath = eventPathFor('P002-happy');

    const fastClient = new OpenAIClient('test-key', fx.fastModel, 'http://127.0.0.1:9/v1');
    const { fetchMock, calls } = installGateway([
      { content: fx.fastOutput, finish_reason: fx.fastFinishReason },
    ]);

    const result = await extractFromWindowReliable(fastClient, windowFromFixture(fx), {
      model: fx.fastModel,
      eventLogPath: eventPath,
    });

    expect(textsOf(result)).toEqual(rawTexts(fx.fastOutput));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].body.model).toBe(fx.fastModel);
    expect(existsSync(eventPath)).toBe(false);
  });
});

describe('retry succeeds without fallback', () => {
  it('returns the fast retry result and records only the retry event', async () => {
    const bad = loadFixture('P030-parse-fail');
    const good = loadFixture('P002-good');
    const eventPath = eventPathFor('P030-retry-good');

    const fastClient = new OpenAIClient('test-key', bad.fastModel, 'http://127.0.0.1:9/v1');
    const autoClient = new OpenAIClient('test-key', bad.autoModel, 'http://127.0.0.1:9/v1');
    const { fetchMock, calls } = installGateway([
      { content: bad.fastOutput, finish_reason: bad.fastFinishReason },
      { content: good.fastOutput, finish_reason: good.fastFinishReason },
    ]);

    const result = await extractFromWindowReliable(fastClient, windowFromFixture(bad), {
      model: bad.fastModel,
      fallbackModel: bad.autoModel,
      createFallbackClient: () => autoClient,
      eventLogPath: eventPath,
    });

    // The good fast retry result is adopted (not the fallback's).
    expect(textsOf(result)).toEqual(rawTexts(good.fastOutput));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.body.model)).toEqual([bad.fastModel, bad.fastModel]);

    const lines = readFileSync(eventPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ stage: 'retry', reason: 'parse_fail', model: bad.fastModel, fallbackModel: bad.autoModel });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
