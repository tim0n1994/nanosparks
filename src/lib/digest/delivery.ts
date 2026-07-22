/**
 * Digest delivery (PRD §C3: 每周 digest — 邮件 + 服务号模板消息).
 *
 * After the digest worker collects new episodes for a follower, this module
 * delivers the digest via two channels: email (transactional provider) and
 * WeChat service-account template message. Email is abstracted behind a
 * DeliveryBackend so the production impl can be swapped without touching logic.
 */

import { logger } from '@/lib/logger';

export interface DigestItem {
  episodeTitle: string;
  showTitle?: string;
  coverUrl?: string;
  readUrl: string;
}

export interface DigestRecipient {
  userId: string;
  email?: string;
  wechatOpenId?: string;
}

export interface EmailBackend {
  send(to: string, subject: string, htmlBody: string): Promise<void>;
}

/** No-op email backend used when email is unconfigured (logs the send). */
export const LOGGING_EMAIL_BACKEND: EmailBackend = {
  async send(to, subject) {
    logger.info('digest email (no-op backend)', { to, subject });
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build the digest email HTML body. Pure logic — testable. */
export function buildDigestEmailHtml(recipientName: string, items: DigestItem[]): string {
  const list = items
    .map((it) => {
      const show = it.showTitle ? ` — ${escapeHtml(it.showTitle)}` : '';
      return `<li><a href="${escapeHtml(it.readUrl)}">${escapeHtml(it.episodeTitle)}</a>${show}</li>`;
    })
    .join('');
  return [
    `<p>${escapeHtml(recipientName)}，本周你关注的节目更新了 ${items.length} 集：</p>`,
    `<ul>${list}</ul>`,
    `<p><a href="https://nanosparks.example">NanoSparks</a></p>`,
  ].join('');
}

/** Build the digest email subject line. Pure logic. */
export function buildDigestSubject(itemCount: number): string {
  return `本周关注更新：${itemCount} 集新内容`;
}

/** Deliver a digest to one recipient via all configured channels. */
export async function deliverDigest(
  recipient: DigestRecipient,
  items: DigestItem[],
  email: EmailBackend | null,
  sendWechatTemplate?: (openId: string, items: DigestItem[]) => Promise<void>,
): Promise<{ emailSent: boolean; wechatSent: boolean }> {
  if (items.length === 0) {
    return { emailSent: false, wechatSent: false };
  }

  let emailSent = false;
  let wechatSent = false;

  if (email && recipient.email) {
    try {
      await email.send(recipient.email, buildDigestSubject(items.length), buildDigestEmailHtml(recipient.userId, items));
      emailSent = true;
    } catch (err) {
      logger.warn('digest email send failed', { userId: recipient.userId, error: String(err) });
    }
  }

  if (sendWechatTemplate && recipient.wechatOpenId) {
    try {
      await sendWechatTemplate(recipient.wechatOpenId, items);
      wechatSent = true;
    } catch (err) {
      logger.warn('digest wechat template send failed', { userId: recipient.userId, error: String(err) });
    }
  }

  return { emailSent, wechatSent };
}

/**
 * Partition new episodes into per-recipient digests based on their follows.
 * Pure logic — dedupes by readUrl in case a user follows both a show and topic.
 */
export function groupDigestsByRecipient(
  follows: Array<{ userId: string; targetType: string; targetId: string }>,
  newEpisodesByTarget: Map<string, DigestItem[]>,
): Map<string, DigestItem[]> {
  const byUser = new Map<string, DigestItem[]>();
  for (const f of follows) {
    const items = newEpisodesByTarget.get(f.targetId) ?? [];
    if (items.length === 0) continue;
    const existing = byUser.get(f.userId) ?? [];
    for (const it of items) {
      if (!existing.some((e) => e.readUrl === it.readUrl)) existing.push(it);
    }
    byUser.set(f.userId, existing);
  }
  return byUser;
}
