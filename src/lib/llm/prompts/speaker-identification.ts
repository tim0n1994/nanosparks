export const SPEAKER_IDENTIFICATION_PROMPT = `分析以下播客对话，识别所有说话人。

要求：
- 分配一致的 ID（s1, s2, ...）
- 如果能推断出名字就用名字，否则用描述性标签（如"主持人（男）"）
- 角色分类：host（主持人）、guest（嘉宾）、expert（专家）、moderator（主持人）
- 说话人名字保持原文语言（中文名字用中文，英文名字用英文）

输出 JSON：
{
  "speakers": [
    {
      "id": "s1",
      "name": "说话人名字",
      "role": "host"
    }
  ]
}

对话内容：
{{transcript}}
`;
