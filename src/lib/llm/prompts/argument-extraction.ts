export const ARGUMENT_EXTRACTION_PROMPT = `分析以下播客对话，提取出论点结构。请用原文语言（中文或英文）输出。

要求：
- 忽略闲聊、填充词和过渡语，聚焦实质性论点。
- 每个论点用 1-2 句话概括核心观点（保持原文语言）。
- 分类：claim（新主张）、support（支持/补充）、oppose（反驳/质疑）、refine（深化/延展）。
- 如果某个论点回应了前面的论点，填写 parentId。
- 最多提取 20 个最重要的论点。
- 说话人名字保持原文样式。

输出 JSON：
{
  "arguments": [
    {
      "id": "a1",
      "text": "论点核心观点",
      "speakerId": "s1",
      "type": "claim",
      "parentId": null,
      "timestamp": 120,
      "confidence": 0.95,
      "stance": "assert"
    }
  ]
}

对话内容：
{{transcript}}
`;

/**
 * V1/T-V1-2: windowed thought-unit extraction prompt.
 *
 * Unlike ARGUMENT_EXTRACTION_PROMPT (which emits a flat `arguments[]` for the
 * legacy episode path), this is shaped to match the windowed-extraction Zod
 * schema: `thoughtUnits[]` each carrying a `speakerLabel` (copied verbatim from
 * the window's [标签] marker) and an argumentative `stance`. Output is folded
 * into the SAME completeStructured call, so this adds zero extra LLM calls.
 */
export const WINDOWED_THOUGHT_EXTRACTION_PROMPT = `分析以下播客对话窗口，提取实质性思想单元（ThoughtUnit）。请用原文语言（中文或英文）输出。

要求：
- 忽略闲聊、填充词和过渡语，聚焦实质性论点/证据/结论。
- 每个思想单元用 1-2 句话概括核心内容（保持原文语言）。
- 分类 type：claim（主张）、question（提问）、evidence（证据/事实）、objection（反驳）、decision（决定）、risk（风险）、insight（洞见）。
- speakerLabel：从窗口内的 [说话人标签] 中照抄该思想单元归属的说话人标签原文（如 "s1"、"SPEAKER_00"、"张三"）。无法判断时留空。
- stance：该思想单元的论辩立场，取值之一：assert（主张/肯定）、oppose（反驳/反对）、question（质疑/求证）、concede（让步/认同对方）、neutral（中立陈述）。纯事实/证据类用 neutral。
- evidenceSpans：引用窗口中的原话，照抄其 turnIndex、startMs、endMs。turnIndex 是整集全局序号，时间为整集绝对毫秒，不能从窗口起点重新计数或估算词级时间。跨话轮引用使用首个话轮序号、首个开始时间和末个结束时间；无法找到原话时返回空 evidenceSpans。
- 最多 12 个最重要的思想单元；每条 text 不超过 100 字，宁缺毋滥。
- 每条思想单元 evidenceSpans 至多 2 条，quote 不超过 60 字。

同时抽取窗口内被提及的命名实体（并入同一次输出，不要分多次）：
- type 取值：person（人物）、org（机构/公司）、product（产品/工具）、book（书/作品）、concept（概念/理论）、event（事件）。
- surfaceForm：窗口内原文出现的称呼（照抄原文，包括别名/简称）。
- canonicalGuess：规范化名称（去歧义、统一写法）。
- entities 最多 20 个，避免重复同一指称。

输出 JSON：
{
  "thoughtUnits": [
    {
      "type": "claim",
      "text": "思想单元核心内容",
      "speakerLabel": "s1",
      "stance": "assert",
      "confidence": 0.85,
      "evidenceSpans": [
        { "turnIndex": 0, "startMs": 12000, "endMs": 18000, "quote": "原话引用" }
      ]
    }
  ],
  "entities": [
    { "surfaceForm": "OpenAI", "type": "org", "canonicalGuess": "OpenAI" }
  ]
}

对话窗口内容：
{{transcript}}
`;
