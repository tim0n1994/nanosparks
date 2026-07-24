/**
 * E5 评测：抽取管线的纯指标函数（PRD §7 质量闸门）。
 *
 * 三类指标，全部纯函数以便单元测试，脚本（scripts/eval-*.ts）直接调用：
 *   1. 实体消解 precision / recall / F1（基于人工标注的 same/different 配对）
 *   2. claim 聚类质量（轮廓系数 silhouette，-1..1，越大越内聚外散）
 *   3. 归属准确率（TU→participant 抽样命中率）
 *
 * 这些是上线前的质量闸门，不是 demo 功能；指标定义钉死在此，便于复跑可比。
 */

// ─── 1. 实体消解 precision / recall / F1 ──────────────────────

export interface EntityPair {
  /** gold-standard label: 两候选是否指同一实体 */
  same: boolean;
  /** 系统判定是否合并 */
  merged: boolean;
}

export interface ClassificationMetrics {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

/**
 * 纯：对一组 (gold, predicted) 配对算 precision/recall/F1。
 * - TP: gold=same 且 merged=true（正确合并）
 * - FP: gold=different 但 merged=true（错误合并，最危险）
 * - FN: gold=same 但 merged=false（漏合并）
 * 空集返回 0（避免除零），调用方自行判断样本量是否足够。
 */
export function entityResolutionMetrics(pairs: EntityPair[]): ClassificationMetrics {
  let tp = 0, fp = 0, fn = 0;
  for (const p of pairs) {
    if (p.merged && p.same) tp++;
    else if (p.merged && !p.same) fp++;
    else if (!p.merged && p.same) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn };
}

// ─── 2. 轮廓系数 silhouette（claim 聚类质量） ─────────────────

/** 纯：两向量的余弦距离（0=同向，2=反向）。用于轮廓系数的相异度。 */
export function cosineDist(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  return mag === 0 ? 1 : 1 - dot / mag;
}

/** 样本 i 到同簇其它成员的平均距离 a(i)。同簇只剩自己时记为 0（轮廓未定义边界）。 */
function meanIntraDistance(i: number, cluster: number[], vectors: number[][]): number {
  let members = 0, sum = 0;
  for (let j = 0; j < cluster.length; j++) {
    if (j === i || cluster[j] !== cluster[i]) continue;
    sum += cosineDist(vectors[i], vectors[j]);
    members++;
  }
  return members === 0 ? 0 : sum / members;
}

/** 样本 i 到最近的「其它簇」的平均距离 b(i)。 */
function meanNearestOtherDistance(i: number, cluster: number[], vectors: number[][]): number {
  const ownCluster = cluster[i];
  const byCluster = new Map<number, number[]>();
  for (let j = 0; j < cluster.length; j++) {
    if (cluster[j] === ownCluster) continue;
    if (!byCluster.has(cluster[j])) byCluster.set(cluster[j], []);
    byCluster.get(cluster[j])!.push(j);
  }
  if (byCluster.size === 0) return 0; // 只有一个簇 → 轮廓未定义，返回 0
  let best = Infinity;
  for (const idxs of byCluster.values()) {
    let sum = 0;
    for (const j of idxs) sum += cosineDist(vectors[i], vectors[j]);
    const mean = sum / idxs.length;
    if (mean < best) best = mean;
  }
  return best;
}

/**
 * 纯：整体轮廓系数。每个样本 s(i) = (b-a)/max(a,b)，对 a=0 或无他簇的样本按 0 处理。
 * 范围 -1..1：接近 1 = 簇内聚且与他簇分离好；接近 0 = 簇重叠；<0 = 多数样本被错簇。
 * 单簇情况返回 0（无分离可衡量）。
 */
export function silhouetteScore(vectors: number[][], cluster: number[]): number {
  if (vectors.length === 0 || vectors.length !== cluster.length) return 0;
  const uniqueClusters = new Set(cluster);
  if (uniqueClusters.size <= 1) return 0;
  let sum = 0, count = 0;
  for (let i = 0; i < vectors.length; i++) {
    const a = meanIntraDistance(i, cluster, vectors);
    const b = meanNearestOtherDistance(i, cluster, vectors);
    const denom = Math.max(a, b);
    if (denom > 0) { sum += (b - a) / denom; count++; }
  }
  return count > 0 ? sum / count : 0;
}

// ─── 3. 归属准确率（TU → participant） ────────────────────────

export interface AttributionSample {
  /** gold-standard 该 TU 真实归属的 participantId（null=无人发言） */
  goldParticipantId: string | null;
  /** 系统写入 ThoughtUnit.participantId */
  predictedParticipantId: string | null;
}

/**
 * 纯：归属准确率。完全匹配（含双方都 null）算命中；不一致算错。
 * 返回准确率 + 样本数，调用方判断样本量是否够（PRD §7 目标 ≥0.9）。
 */
export function attributionAccuracy(samples: AttributionSample[]): { accuracy: number; total: number; correct: number } {
  if (samples.length === 0) return { accuracy: 0, total: 0, correct: 0 };
  let correct = 0;
  for (const s of samples) {
    if ((s.goldParticipantId ?? null) === (s.predictedParticipantId ?? null)) correct++;
  }
  return { accuracy: correct / samples.length, total: samples.length, correct };
}
