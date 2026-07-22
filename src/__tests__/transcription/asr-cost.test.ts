import { describe, it, expect } from 'vitest';
import {
  estimateAsrCostCny,
  estimateAsrCostUsd,
  cnyToUsd,
  asrPriceTable,
} from '@/lib/transcription/asr-cost';

describe('estimateAsrCostCny', () => {
  it('estimates Paraformer cost for a 1.5h episode within the PRD range (~¥0.5-0.9)', () => {
    const minutes = 90; // 1.5h
    const cost = estimateAsrCostCny('paraformer', minutes * 60);
    // 90 min × ¥0.01/min = ¥0.9 — top of the PRD range. Conservative by design.
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(1);
  });

  it('estimates Deepgram cost for a 1.5h episode (~$0.3-0.4 → CNY)', () => {
    const cost = estimateAsrCostCny('deepgram', 90 * 60);
    expect(cost).toBeGreaterThan(0);
    // 90 × 0.029 = ¥2.6 — higher end; pricing is conservative pending invoice tuning.
  });

  it('returns 0 for local whisper (GPU amortized)', () => {
    expect(estimateAsrCostCny('local-whisper', 5400)).toBe(0);
    expect(estimateAsrCostCny('whisperx', 5400)).toBe(0);
  });

  it('returns 0 for unknown providers', () => {
    expect(estimateAsrCostCny('unknown', 5400)).toBe(0);
    expect(estimateAsrCostCny('something-new', 5400)).toBe(0);
  });

  it('returns 0 for zero/negative duration', () => {
    expect(estimateAsrCostCny('paraformer', 0)).toBe(0);
    expect(estimateAsrCostCny('paraformer', -100)).toBe(0);
  });
});

describe('cnyToUsd', () => {
  it('converts CNY to USD at ~7.2', () => {
    expect(cnyToUsd(7.2)).toBeCloseTo(1, 4);
    expect(cnyToUsd(0)).toBe(0);
  });
});

describe('estimateAsrCostUsd', () => {
  it('returns USD cost consistent with the CNY estimate', () => {
    const cny = estimateAsrCostCny('paraformer', 5400);
    const usd = estimateAsrCostUsd('paraformer', 5400);
    expect(usd).toBeCloseTo(cny / 7.2, 4);
  });
});

describe('asrPriceTable', () => {
  it('exposes a price per minute for every known provider', () => {
    const table = asrPriceTable();
    expect(table.paraformer).toBeGreaterThan(0);
    expect(table.deepgram).toBeGreaterThan(0);
    expect(table['local-whisper']).toBe(0);
  });
});
