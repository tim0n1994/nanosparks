/**
 * V2/T-V2-2: per-window named-entity extraction prompt.
 *
 * Folded into the SAME windowed completeStructured call as argument extraction
 * (the window schema carries an `entities[]` field), so this adds zero extra LLM
 * calls per episode. Output is canonicalized downstream by the three-level
 * resolver (exact → embedding → LLM arbitration).
 */

export const ENTITY_EXTRACTION_PROMPT = `从以下播客对话窗口中，抽取被提及的命名实体（Named Entities）。请用原文语言输出。

要求：
- 只抽取实质性、可被消解的命名实体，跳过代词和泛指。
- type 取值：person（人物）、org（机构/公司）、product（产品/工具）、book（书/作品）、concept（概念/理论）、event（事件）。
- surfaceForm：窗口内原文出现的称呼（照抄原文，包括别名/简称）。
- canonicalGuess：你对该实体的规范化名称（去歧义、统一写法）。
- 最多 20 个最重要的实体，避免重复同一指称。

输出 JSON：
{
  "entities": [
    {
      "surfaceForm": "OpenAI",
      "type": "org",
      "canonicalGuess": "OpenAI"
    }
  ]
}

对话窗口内容：
{{transcript}}
`;
