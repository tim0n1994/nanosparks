// Per-turn speaker assignment prompt.
// Given a list of turns (with index + text) and the known speakers, assign each
// turn to a speaker. Used when the ASR provider returns no per-segment speaker
// labels (e.g. Qwen3-ASR without pyannote), so attribution still reaches the reader.

export const SPEAKER_ASSIGNMENT_PROMPT = `你是一位播客转写校对员。下面给出已识别的说话人列表和一组带编号的发言片段（turn）。
请为每一片段判断是哪位说话人说的。

规则：
- 只能使用 speakers 列表里出现的 id（如 s1、s2）
- 根据上下文、自称、称呼对方、内容连贯性来判断
- 同一说话人的连续发言可能被切成多段，都要归到同一 id
- 不确定的也要给出最佳猜测，不能留空

已知说话人：
{{speakers}}

发言片段：
{{turns}}

输出 JSON（数组，元素与片段顺序一一对应）：
[
  { "turnIndex": 0, "speakerId": "s1" },
  { "turnIndex": 1, "speakerId": "s2" }
]
`;
