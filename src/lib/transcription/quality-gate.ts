/**
 * §5.6 质量门：让「精确」可测量，并卡住不达标的集不进蒸馏层。
 *
 * PRD：「不达标则不进蒸馏层是这套设计里最重要的一条纪律。一集归属率 60% 的语料
 * 喂进指纹层，产出的不是稍差的画像，是看起来很像但错得理直气壮的画像。」
 *
 * 四项准入指标（§5.6 表）：
 *   转写覆盖率        max(turn.endMs)/durationMs       ≥ 0.98
 *   说话人归属率      1 − null率                       ≥ 0.95
 *   归属置信中位数    median(attributionConfidence)    ≥ 0.80
 *   校正改动率        被改字数/总字数                   ≤ 0.08
 *
 * ground truth：§13.4 未决，按推荐——接受「LLM 校正改动率」+ 可自动算指标作为代理。
 * Pure metrics exported for testing; the gate returns an admission decision.
 */

export interface ConversationMetrics {
  /** 0..1, or null when the real episode duration is unknown — never fabricated
   * from max(turn.endMs) (that made the metric identically 1.0, a tautology). */
  coverageRate: number | null;
  attributionRate: number;    // 0..1 (1 - null rate)
  /** median over REAL per-turn confidences only (backfilled constants excluded
   * by the caller); null when no genuine confidence exists — not 0, not 0.9. */
  attributionConfidenceMedian: number | null;
  correctionRate: number;     // 0..1 (changed chars / total)
  turnCount: number;
  durationMs: number;
}

export interface GateThresholds {
  coverageRate: number;
  attributionRate: number;
  attributionConfidenceMedian: number;
  correctionRateMax: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  coverageRate: 0.98,
  attributionRate: 0.95,
  attributionConfidenceMedian: 0.80,
  correctionRateMax: 0.08,
};

export interface GateFailure {
  metric: keyof GateThresholds;
  value: number;
  threshold: number;
}

export interface GateDecision {
  admitted: boolean;
  metrics: ConversationMetrics;
  failures: GateFailure[];
  /** metrics that could not be verified (unknown duration / no real confidences).
   * They do not block admission, but callers MUST surface them — an unverified
   * metric is not a passing metric. */
  unverified: Array<'coverageRate' | 'attributionConfidenceMedian'>;
  /** if not admitted, the PRD-mandated fallback: T0 only (quotes), no distillation */
  fallback: 't0_only' | 'full';
}

/** Pure: median of a numeric array (0 for empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure: compute the four §5.6 metrics from raw conversation data. All inputs are
 * auto-computable (no human WER needed — §13.4 resolution).
 */
export function computeMetrics(opts: {
  turnEndMsMax: number;
  /** REAL episode duration (e.g. GlobalEpisode.durationSec*1000). Pass 0 when
   * unknown — coverage then reports null instead of a fabricated 100%. */
  durationMs: number;
  turnCount: number;
  attributedCount: number;       // turns with participantId not null
  /** per-turn confidences from a real attribution run only — callers must
   * exclude backfilled constants (attributionMethod='backfill') and nulls. */
  attributionConfidences: number[];
  correctedChars: number;        // chars changed by the correction pass
  totalChars: number;
}): ConversationMetrics {
  return {
    coverageRate: opts.durationMs > 0 ? Math.min(1, opts.turnEndMsMax / opts.durationMs) : null,
    attributionRate: opts.turnCount > 0 ? opts.attributedCount / opts.turnCount : 0,
    attributionConfidenceMedian:
      opts.attributionConfidences.length > 0 ? median(opts.attributionConfidences) : null,
    correctionRate: opts.totalChars > 0 ? opts.correctedChars / opts.totalChars : 0,
    turnCount: opts.turnCount,
    durationMs: opts.durationMs,
  };
}

/**
 * Pure: admit a conversation to the distillation layer iff all four metrics pass.
 * Failure → fallback 't0_only' (quotes/excerpts still allowed, but no L2/L3 distillation).
 */
export function admitToDistillation(
  metrics: ConversationMetrics,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): GateDecision {
  const failures: GateFailure[] = [];
  const unverified: GateDecision['unverified'] = [];
  if (metrics.coverageRate === null) {
    unverified.push('coverageRate');
  } else if (metrics.coverageRate < thresholds.coverageRate) {
    failures.push({ metric: 'coverageRate', value: metrics.coverageRate, threshold: thresholds.coverageRate });
  }
  if (metrics.attributionRate < thresholds.attributionRate) {
    failures.push({ metric: 'attributionRate', value: metrics.attributionRate, threshold: thresholds.attributionRate });
  }
  if (metrics.attributionConfidenceMedian === null) {
    unverified.push('attributionConfidenceMedian');
  } else if (metrics.attributionConfidenceMedian < thresholds.attributionConfidenceMedian) {
    failures.push({ metric: 'attributionConfidenceMedian', value: metrics.attributionConfidenceMedian, threshold: thresholds.attributionConfidenceMedian });
  }
  if (metrics.correctionRate > thresholds.correctionRateMax) {
    failures.push({ metric: 'correctionRateMax', value: metrics.correctionRate, threshold: thresholds.correctionRateMax });
  }
  return {
    admitted: failures.length === 0,
    metrics,
    failures,
    unverified,
    fallback: failures.length === 0 ? 'full' : 't0_only',
  };
}
