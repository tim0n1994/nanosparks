export const SUMMARY_GENERATION_PROMPT = `你是一个专业的播客内容总结助手。请根据以下播客转录内容，用中文生成一份结构化的播客摘要。

要求：
1. 用 200-300 字概述本期播客的核心内容
2. 提取 3-5 个关键要点（key takeaways）
3. 标注播客的语言（中文/英文）
4. 如果播客有多个说话人，标注主持人是谁

输出 JSON：
{
  "summary": "播客概述",
  "takeaways": ["要点1", "要点2", "要点3"],
  "language": "zh",
  "host": "主持人名字"
}

Transcript:
{{transcript}}
`;
