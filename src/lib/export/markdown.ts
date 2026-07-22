/**
 * Conversation → Markdown / Obsidian export (PRD §A3 "导出 MD/Obsidian").
 *
 * Renders a conversation as a single Markdown document with YAML frontmatter
 * (Obsidian-friendly), a TL;DR, 金句, a participant roster, and the full
 * timestamped transcript. Pure logic — testable without DB/HTTP.
 */

export interface ExportTurn {
  turnIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerName: string | null;
  speakerLabel: string | null;
}

export interface ExportParticipant {
  name: string;
  speakerLabel: string | null;
  role: string | null;
}

export interface ExportThoughtUnit {
  type: string;
  text: string;
}

export interface ExportConversationInput {
  title: string;
  showTitle?: string | null;
  sourceUrl?: string | null;
  durationSec?: number | null;
  platform?: string | null;
  participants: ExportParticipant[];
  tldr: ExportThoughtUnit[];
  quotes: ExportThoughtUnit[];
  turns: ExportTurn[];
}

/** Format ms as hh:mm:ss or mm:ss. */
function fmt(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Escape a string for safe YAML scalar value. */
function yamlStr(s: string | null | undefined): string {
  if (!s) return '""';
  // Quote if it contains special chars; otherwise bare.
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s) || s.includes('\n')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Serialize a conversation to Obsidian-friendly Markdown. */
export function conversationToMarkdown(input: ExportConversationInput): string {
  const lines: string[] = [];

  // YAML frontmatter (Obsidian parses this as note metadata).
  lines.push('---');
  lines.push(`title: ${yamlStr(input.title)}`);
  if (input.showTitle) lines.push(`show: ${yamlStr(input.showTitle)}`);
  if (input.platform) lines.push(`platform: ${yamlStr(input.platform)}`);
  if (input.durationSec) lines.push(`duration_sec: ${input.durationSec}`);
  if (input.sourceUrl) lines.push(`source: ${yamlStr(input.sourceUrl)}`);
  lines.push(`exported_at: ${new Date().toISOString()}`);
  lines.push(`tags: [podcast, nanosparks]`);
  lines.push('---');
  lines.push('');

  lines.push(`# ${input.title}`);
  if (input.showTitle) lines.push(`\n*《${input.showTitle}》*`);
  lines.push('');

  // TL;DR
  if (input.tldr.length > 0) {
    lines.push('## TL;DR');
    for (const t of input.tldr) {
      lines.push(`- ${t.text}`);
    }
    lines.push('');
  }

  // 金句
  if (input.quotes.length > 0) {
    lines.push('## 金句');
    for (const q of input.quotes) {
      lines.push(`> ${q.text}`);
    }
    lines.push('');
  }

  // Participants
  if (input.participants.length > 0) {
    lines.push('## 说话人');
    for (const p of input.participants) {
      lines.push(`- **${p.name}**${p.role ? ` (${p.role})` : ''}${p.speakerLabel ? ` \`${p.speakerLabel}\`` : ''}`);
    }
    lines.push('');
  }

  // Full transcript with timestamps
  lines.push('## 全文');
  for (const t of input.turns) {
    const speaker = t.speakerName ?? t.speakerLabel ?? '?';
    lines.push(`**${speaker}** \`${fmt(t.startMs)}\``);
    lines.push('');
    lines.push(t.text);
    lines.push('');
  }

  if (input.sourceUrl) {
    lines.push('---');
    lines.push(`[原链接](${input.sourceUrl})`);
  }

  return lines.join('\n');
}

/** A safe filename for the export download. */
export function exportFilename(title: string): string {
  const base = (title || 'episode')
    .replace(/[^\w\u4e00-\u9fff -]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60)
    .trim();
  return `${base || 'episode'}.md`;
}
