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
      "confidence": 0.95
    }
  ]
}

对话内容：
{{transcript}}
`;
