/**
 * 中文（CJK）空格清理。
 *
 * 某些 ASR provider（如 Whisper 的某些配置）在中文分词时会在字/词之间插入多余空格：
 *   "哈 喽 大家好我是 小 俊" → 应为 "哈喽大家好我是小俊"
 *
 * 规则（保守，不破坏中英混排）：
 *   - 两个 CJK 字符之间的空格 → 删除
 *   - CJK 字符与 ASCII 字母/数字之间的空格 → 保留（中英混排需要）
 *   - 连续空格 → 先压缩为单个，再做 CJK 检测
 *   - 行首/行尾空格 → trim
 *
 * Pure function, exported for testing.
 */

/** True if char is a CJK ideograph (common ranges). */
export function isCJK(ch: string): boolean {
  if (!ch) return false;
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) ||  // Ext A
    (code >= 0xf900 && code <= 0xfaff) ||  // Compatibility
    (code >= 0x3040 && code <= 0x30ff) ||  // Hiragana + Katakana
    (code >= 0xac00 && code <= 0xd7af)     // Hangul
  );
}

/**
 * Remove spurious spaces between CJK characters while preserving spaces needed
 * for CJK↔ASCII boundaries and ASCII word separation.
 */
export function cleanCjkSpaces(text: string): string {
  if (!text) return text;
  // Collapse runs of spaces first, so "中  文" → "中 文" → detect CJK-space-CJK → "中文".
  const collapsed = text.replace(/ {2,}/g, ' ');
  const chars = [...collapsed];
  const out: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ') {
      const prev = out[out.length - 1] ?? '';
      const next = chars[i + 1] ?? '';
      // CJK space CJK → remove.
      if (isCJK(prev) && isCJK(next)) continue;
      out.push(ch);
    } else {
      out.push(ch);
    }
  }

  return out.join('').trim();
}
