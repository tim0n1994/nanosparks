/**
 * ASR cost estimation (PRD §A2 成本打点 + §7 单位经济学).
 *
 * ASR is the largest per-episode cost component (Paraformer ~¥0.5-0.9, Deepgram
 * ~$0.3-0.4 per PRD §7). To honor "成本打点进 ExtractionRun.costUsd", we estimate
 * the ASR cost from the result's billed duration (Paraformer bills on speech
 * duration; Deepgram on audio minutes) and provider pricing.
 *
 * Pure logic — pricing is a lookup table, testable without network.
 */

export type AsrProviderName = 'paraformer' | 'deepgram' | 'whisperx' | 'local-whisper' | 'unknown';

/** Per-provider pricing (CNY per minute of audio). PRD §7 + provider docs. */
const PRICE_CNY_PER_MINUTE: Record<AsrProviderName, number> = {
  // Paraformer: voice-duration billing, ~¥0.5-0.9 per 1.5h → ~¥0.006-0.01/min.
  // Use the conservative (higher) end; tuned from real invoices post-launch.
  paraformer: 0.01,
  // Deepgram: ~$0.3-0.4 per 1.5h → ~$0.004/min → ~¥0.029/min.
  deepgram: 0.029,
  // Local whisper: GPU amortized → ~¥0 (operational only).
  whisperx: 0,
  'local-whisper': 0,
  unknown: 0,
};

/**
 * Estimate ASR cost in CNY for a transcription given its billed audio duration.
 * @param providerName provider identifier
 * @param billedDurationSec audio duration billed (Paraformer: speech duration; Deepgram: full audio)
 */
export function estimateAsrCostCny(providerName: string, billedDurationSec: number): number {
  const pricePerMin = PRICE_CNY_PER_MINUTE[(providerName as AsrProviderName)] ?? 0;
  const minutes = Math.max(0, billedDurationSec) / 60;
  return Math.round(pricePerMin * minutes * 100) / 100;
}

/** Convert CNY to USD at a rough 7.2 rate (used for costUsd storage). */
export function cnyToUsd(cny: number): number {
  return Math.round((cny / 7.2) * 10000) / 10000;
}

/** Estimate ASR cost in USD (for ExtractionRun.costUsd accumulation). */
export function estimateAsrCostUsd(providerName: string, billedDurationSec: number): number {
  return cnyToUsd(estimateAsrCostCny(providerName, billedDurationSec));
}

/** The pricing table (exposed for tests / display). */
export function asrPriceTable(): Record<AsrProviderName, number> {
  return { ...PRICE_CNY_PER_MINUTE };
}
