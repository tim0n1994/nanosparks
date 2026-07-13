export const REFERENCE_GENERATION_PROMPT = `根据以下播客对话内容及其提取的论点，生成相关的参考文献链接。

要求：
- 提供真实可访问的 URL，不要编造链接。
- 优先使用权威来源：arxiv.org、wikipedia.org、github.com、zhuanlan.zhihu.com 等。
- 每条参考文献包含：URL、标题、一句话描述、相关性评分（0.0-1.0）。
- 最多 10 条最相关的参考文献。
- 中文播客请使用中文标题和描述，英文播客用英文。

输出 JSON：
{
  "references": [
    {
      "url": "https://arxiv.org/abs/2209.00626",
      "title": "论文标题",
      "description": "与讨论相关的原因",
      "relevanceScore": 0.95
    }
  ]
}

对话内容：
{{transcript}}

论点：
{{arguments}}
`;
