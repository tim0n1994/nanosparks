/**
 * Episode title + description → concise Chinese summary.
 *
 * Used by the multi-episode picker: when a show is in English (or any non-zh
 * language), each row can be expanded to show a translated title + one-line
 * Chinese summary so the user can judge which episodes are worth downloading
 * without reading the foreign-language shownotes.
 *
 * Cheap model, one call per episode, lazily (on expand) — never blocks the list.
 */

export const EPISODE_SUMMARY_PROMPT = `你是一个播客选集助手。把下面这一集的英文标题和简介，翻译并浓缩成中文，帮助中文读者快速判断这集值不值得听。

要求：
- translatedTitle：标题的中文翻译（简洁，不要加书名号）。
- summary：一句话中文摘要（≤40 字），点出这集讨论的核心人物/公司/主题/看点。
- 用中文输出，保留原文的人名/公司名（可附英文原名一次）。

原标题与简介：
TITLE: {{title}}
DESCRIPTION: {{description}}

输出 JSON：
{
  "translatedTitle": "...",
  "summary": "..."
}
`;
