export const TOPIC_EXTRACTION_PROMPT = `分析以下播客对话，提取讨论的主要话题。

要求：
- 每个话题用简洁的名称（2-4个词，中文播客用中文，英文播客用英文）
- 统计该话题被提及或讨论的次数
- 分析情感倾向：positive（正面）、neutral（中立）、negative（负面）
- 列出话题出现的时间戳（秒）

聚焦实质性话题，忽略闲聊和题外话。

输出 JSON：
{
  "topics": [
    {
      "id": "t1",
      "name": "话题名称",
      "mentionCount": 8,
      "sentiment": "neutral",
      "timestamps": [120, 180, 240]
    }
  ]
}

对话内容：
{{transcript}}
`;
