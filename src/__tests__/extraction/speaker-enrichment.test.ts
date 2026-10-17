import { describe, expect, it, vi } from 'vitest';
import { enrichSpeakers, SPEAKER_PROMPT_LIMIT } from '@/lib/extraction/speaker-enrichment';

const parseTurns = (prompt: string) => JSON.parse(prompt.split('\nTRANSCRIPT_JSON\n')[1]) as Array<{ turnIndex: number; offset: number; text: string }>;
const clientWith = (reply: (prompt: string) => unknown) => ({
  completeWithRetry: vi.fn(async (messages: Array<{ content: string }>) => ({ content: JSON.stringify(reply(messages[0].content)) })),
});

describe('bounded full-transcript speaker enrichment', () => {
  it.each(['SPEAKER_UNKNOWN', 'speaker-unidentified', 'Speaker A', 'SPEAKER_B', 'speaker-7'])('rejects the generic placeholder %s without discarding supported names', async (name) => {
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER') ? [{ name }, { name: 'Marc Andreessen' }] : []);
    const result = await enrichSpeakers(client, [{ turnIndex: 10, text: 'Speech' }]);
    expect(result.speakers.map((speaker) => speaker.name)).toEqual(['Marc Andreessen']);
  });

  it('covers all 1788 turns, including a long escaped turn, with serial bounded single-attempt requests', async () => {
    const turns = Array.from({ length: 1788 }, (_, i) => ({ turnIndex: i * 2, text: `Turn ${i}: Marc explains the topic. ` }));
    turns[900].text = '"\\\n'.repeat(5000);
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER')
      ? [{ name: 'Marc Andreessen', role: 'guest' }]
      : parseTurns(prompt).map((t) => ({ turnIndex: t.turnIndex, speakerId: 's1' })));
    const result = await enrichSpeakers(client, turns);
    const calls = client.completeWithRetry.mock.calls as unknown as Array<[Array<{ content: string }>, number, number]>;
    expect(calls.every(([messages, , retries]) => messages[0].content.length <= SPEAKER_PROMPT_LIMIT && retries === 1)).toBe(true);
    const discovered = calls.filter(([messages]) => messages[0].content.startsWith('DISCOVER')).flatMap(([messages]) => parseTurns(messages[0].content));
    for (const turn of turns) expect(discovered.filter((part) => part.turnIndex === turn.turnIndex).sort((a, b) => a.offset - b.offset).map((part) => part.text).join('')).toBe(turn.text);
    expect(result.assignments.size).toBe(turns.length);
    expect(result.coverage.assignmentSuccessfulWindows).toBe(result.coverage.assignmentWindows);
  });

  it('normalizes named speakers across windows without conflating local ids or inventing generic identities', async () => {
    let window = 0;
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER')
      ? (++window === 1 ? [{ id: 's1', name: ' MARC   ANDREESSEN ', role: 'guest' }, { name: 'Host', role: 'host' }]
        : [{ id: 's1', name: 'Marc Andreessen', role: 'guest' }, { id: 's2', name: 'Lex Fridman', role: 'host' }])
      : []);
    const result = await enrichSpeakers(client, [{ turnIndex: 9, text: 'a'.repeat(8000) }]);
    expect(result.speakers.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result.speakers).toHaveLength(2);
    expect(result.assignments.size).toBe(0);
    expect(result.coverage.unknownTurns).toBe(1);
  });

  it('rejects foreign indices, invalid speakers, null and conflicting assignments while retaining valid ones', async () => {
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER') ? [{ name: 'Marc Andreessen' }, { name: 'Lex Fridman' }] : [
      { turnIndex: 10, speakerId: 's1' }, { turnIndex: 10, speakerId: 's2' },
      { turnIndex: 20, speakerId: 'missing' }, { turnIndex: 30, speakerId: null },
      { turnIndex: 40, speakerId: 's1' }, { turnIndex: 999, speakerId: 's1' },
    ]);
    const result = await enrichSpeakers(client, [10, 20, 30, 40].map((turnIndex) => ({ turnIndex, text: 'Some speech' })));
    expect([...result.assignments]).toEqual([[40, 's1']]);
    expect(result.coverage.unknownTurns).toBe(3);
  });

  it('retains unknown when a fragment is missing or conflicts across windows', async () => {
    let assigned = 0;
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER') ? [{ name: 'Marc Andreessen' }, { name: 'Lex Fridman' }]
      : parseTurns(prompt).map((t) => ({ turnIndex: t.turnIndex, speakerId: ++assigned === 1 ? 's1' : 's2' })));
    const result = await enrichSpeakers(client, [{ turnIndex: 7, text: 'a'.repeat(15000) }]);
    expect(result.assignments.size).toBe(0);
    expect(result.coverage.unknownTurns).toBe(1);
  });

  it('records failed windows and continues to the end without accepting truncated coverage', async () => {
    const client = clientWith(() => []);
    client.completeWithRetry.mockRejectedValueOnce(new Error('local context failure'));
    const result = await enrichSpeakers(client, [{ turnIndex: 1, text: 'x'.repeat(16000) }]);
    expect(result.coverage.discoveryWindows).toBeGreaterThan(1);
    expect(result.coverage.discoverySuccessfulWindows).toBe(result.coverage.discoveryWindows - 1);
    expect(result.coverage.failures).toHaveLength(1);
    expect(result.coverage.unknownTurns).toBe(1);
  });

  it('makes at most one request at a time and leaves failed assignment fragments unknown', async () => {
    let active = 0;
    let peak = 0;
    let assignments = 0;
    const client = { completeWithRetry: vi.fn(async (messages: Array<{ content: string }>) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      if (messages[0].content.startsWith('DISCOVER')) return { content: '[{"name":"Marc Andreessen"}]' };
      if (++assignments === 1) throw new Error('provider failed');
      return { content: JSON.stringify(parseTurns(messages[0].content).map((turn) => ({ turnIndex: turn.turnIndex, speakerId: 's1' }))) };
    }) };
    const result = await enrichSpeakers(client, [{ turnIndex: 1, text: 'a'.repeat(14000) }]);
    expect(peak).toBe(1);
    expect(result.assignments.size).toBe(0);
    expect(result.coverage.failures).toEqual([expect.objectContaining({ stage: 'assignment' })]);
  });

  it('does not silently truncate an oversized speaker roster', async () => {
    const client = clientWith(() => Array.from({ length: 100 }, (_, i) => ({ name: `Person ${i} ${'long name '.repeat(10)}` })));
    const result = await enrichSpeakers(client, [{ turnIndex: 10, text: 'Speech' }]);
    expect(client.completeWithRetry).toHaveBeenCalledTimes(1);
    expect(result.coverage.failures[0]).toEqual(expect.objectContaining({ stage: 'assignment', error: expect.stringContaining('roster') }));
    expect(result.coverage.unknownTurns).toBe(1);
  });

  it('does not accept a valid assignment alongside a malformed conflicting record for the same turn', async () => {
    const client = clientWith((prompt) => prompt.startsWith('DISCOVER') ? [{ name: 'Marc Andreessen' }] : [{ turnIndex: 10, speakerId: 's1' }, { turnIndex: 10, speakerId: 7 }]);
    const result = await enrichSpeakers(client, [{ turnIndex: 10, text: 'Speech' }]);
    expect(result.assignments.size).toBe(0);
  });

  it('includes the existing speaker label but never serializes unrelated database fields', async () => {
    const client = clientWith(() => []);
    const turn = { turnIndex: 10, text: 'Speech', speakerLabel: 'Marc Andreessen', rawText: 'unrelated private field', wordsJson: { large: 'metadata' } };
    await enrichSpeakers(client, [turn]);
    const prompt = client.completeWithRetry.mock.calls[0][0][0].content;
    expect(prompt).toContain('Marc Andreessen');
    expect(prompt).not.toContain('rawText');
    expect(prompt).not.toContain('wordsJson');
  });
});
