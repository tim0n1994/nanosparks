import { describe, it, expect, vi } from 'vitest';
import { createWindows, extractFromWindow } from '@/lib/extraction/windowed-extraction';
import type { OpenAIClient } from '@/lib/llm/client';

const quote = 'US K-12 schools are a literal government monopoly.';
const source = { turnIndex: 400, startMs: 4500250, endMs: 4520000, speakerLabel: 's1', text: quote };
const output = { thoughtUnits: [{ type: 'claim', text: 'Claim', confidence: 0.9, evidenceSpans: [{ quote, turnIndex: 2, startMs: 78000, endMs: 79000 }] }], entities: [] };

describe('window extraction coordinate contract', () => {
  it('sends global per-turn coordinates, making different positions distinguishable', () => {
    const late = createWindows([source])[0];
    const early = createWindows([{ ...source, turnIndex: 2, startMs: 53000, endMs: 79000 }])[0];
    expect(late.text).toContain('turnIndex=400, startMs=4500250, endMs=4520000');
    expect(late.text).not.toEqual(early.text);
  });

  it.each([false, true])('verifies source coordinates with fallback=%s', async (fallback) => {
    const client = {
      completeStructured: fallback ? vi.fn().mockRejectedValue(new Error('structured unavailable')) : vi.fn().mockResolvedValue(output),
      completeWithRetry: vi.fn().mockResolvedValue({ content: JSON.stringify(output) }),
    };
    const result = await extractFromWindow(client as unknown as OpenAIClient, createWindows([source])[0]);
    expect(result.thoughtUnits[0].evidenceSpans).toEqual([{ quote, turnIndex: 400, startMs: 4500250, endMs: 4520000 }]);
    expect(client.completeStructured.mock.calls[0][0][0].content).toContain('turnIndex=400');
  });

  it('does not trust coordinates without source-turn evidence', async () => {
    const client = { completeStructured: vi.fn().mockResolvedValue(output) };
    const window = createWindows([source])[0];
    delete window.sourceTurns;
    const result = await extractFromWindow(client as unknown as OpenAIClient, window);
    expect(result.thoughtUnits[0].evidenceSpans).toEqual([]);
  });
});
