export const QUOTE_EXTRACTION_PROMPT = `分析以下播客对话，提取最有见地、最令人印象深刻或最有影响力的引语。

要求：
- 提取原文中 1-3 句话的引语（保持原文语言，不要翻译）
- 标注说话人 ID 和时间戳
- 为每条引语提供一句背景说明，解释为什么这条引语重要
- 最多提取 8 条最有代表性的引语

输出 JSON：
{
  "quotes": [
    {
      "id": "q1",
      "text": "引语的原文内容",
      "speakerId": "s1",
      "timestamp": 125,
      "context": "这条引语在讨论中的意义"
    }
  ]
}

对话内容：
{{transcript}}
`;
