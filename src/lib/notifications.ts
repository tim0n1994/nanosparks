/**
 * Notifications (PRD §2.3: 完成后站内红点+邮件通知).
 *
 * When an episode finishes processing, the user gets an in-app notification
 * (red dot) so they can leave the page during long processing and come back.
 * This module creates + queries notifications. Email delivery reuses the digest
 * delivery EmailBackend pattern.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type NotificationType = 'processing_complete' | 'new_episode' | 'digest';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
}

/** Create a notification (red-dot) for a user. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({ data: input });
  } catch (err) {
    logger.warn('notification create failed', { userId: input.userId, error: String(err) });
  }
}

/** Count unread notifications for a user (for the red-dot badge). */
export async function countUnread(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({ where: { userId, read: false } });
  } catch {
    return 0;
  }
}

/** Mark a notification as read. */
export async function markRead(notificationId: string, userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
}

/** Mark all notifications as read for a user. */
export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

/**
 * Notify the submitting user that their episode is ready to read.
 * Called from the analyze job on completion (PRD §2.3 等待黑洞).
 */
export async function notifyProcessingComplete(args: {
  userId: string;
  conversationId: string;
  title: string;
}): Promise<void> {
  await createNotification({
    userId: args.userId,
    type: 'processing_complete',
    title: `「${args.title}」已就绪，可以阅读了`,
    body: '转写 + 导读 + 金句已全部生成。',
    linkUrl: `/read/${args.conversationId}`,
  });
  logger.info('processing-complete notification sent', { conversationId: args.conversationId });
}
