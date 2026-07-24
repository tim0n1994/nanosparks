/**
 * V3/T-V3-2: persona style-card extraction prompt.
 *
 * Summarizes a person's speaking style (catchphrases, metaphors, sentence
 * patterns, tone) from a sample of their turns. Used by buildPersonProfile to
 * populate PersonProfile.styleJson — consumed later by persona-chat as a
 * style *anchor only* (never an opinion-extrapolation license).
 */

export const PERSONA_STYLE_PROMPT = `分析以下一位播客嘉宾/主持人的发言样本，概括 TA 的语言风格。请用原文语言输出。

要求：
- catchphrases：TA 反复使用的口头禅或标志性表达（最多 8 条）。
- metaphors：TA 常用的比喻或类比（最多 6 条）。
- sentencePatterns：TA 的句式习惯（如喜欢用反问、喜欢举例、喜欢先否定再肯定等，最多 5 条）。
- toneSummary：一句话概括 TA 的整体语气与风格。
- 只概括表达风格，不要复述具体观点。

输出 JSON：
{
  "catchphrases": ["..."],
  "metaphors": ["..."],
  "sentencePatterns": ["..."],
  "toneSummary": "..."
}

发言样本：
{{turns}}
`;
