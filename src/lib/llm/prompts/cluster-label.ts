/**
 * V2/T-V2-8: semantic atlas cluster naming.
 *
 * Given a sample of member texts per cluster, produce one short (≤8 char) label
 * per cluster. Cheap model, single batched call per projection run.
 */

export const CLUSTER_LABEL_PROMPT = `下面是若干语义聚类的成员样本（每个 clusterId 配几条真实文本）。请为每个聚类生成一个简短的主题标签（≤8个字，名词短语，概括这些文本的共同主题）。用样本的语言。

聚类样本（JSON）：
{{clusters}}

输出 JSON：
{
  "labels": [
    { "clusterId": 0, "label": "主题标签" }
  ]
}
`;
