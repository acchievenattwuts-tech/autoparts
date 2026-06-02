import { db } from "@/lib/db";
import { NotificationSeverity, NotificationType, Role } from "@/lib/generated/prisma";
import { sendTelegramNotification, shouldSendTelegramForNotification } from "@/lib/telegram";

/**
 * In-app notification service (general-purpose; per-user fan-out rows).
 *
 * Read state lives in the DB (`Notification.readAt`) — not localStorage — so the
 * bell is consistent across devices. When no explicit `userIds` are given,
 * notifications fan out to all active ADMIN users (shop owner/admins).
 *
 * ISOLATION: only touches the new `Notification` table + reads `User` for fan-out.
 */

const DEFAULT_LIST_TAKE = 20;
const MAX_LIST_TAKE = 50;

export type CreateNotificationInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  severity?: NotificationSeverity;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** When set, skip users who already have an UNREAD row with this key. */
  dedupeKey?: string | null;
  /** Explicit target user ids. Omit to fan out to all active ADMIN users. */
  userIds?: string[];
};

async function resolveTargetUserIds(explicit?: string[]): Promise<string[]> {
  if (explicit && explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  const admins = await db.user.findMany({
    where: { isActive: true, role: Role.ADMIN },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

/**
 * Creates a notification for each target user. Returns the number of rows created.
 * Safe to call from any flow; never throws into the caller's critical path when
 * wrapped with try/catch by the caller.
 */
export async function createNotification(input: CreateNotificationInput): Promise<number> {
  const targetIds = await resolveTargetUserIds(input.userIds);
  if (targetIds.length === 0) return 0;

  if (input.dedupeKey) {
    const existingUnread = await db.notification.findFirst({
      where: { dedupeKey: input.dedupeKey, readAt: null },
      select: { id: true },
    });
    if (existingUnread) return 0;
  }

  let eligibleIds = targetIds;
  if (input.dedupeKey) {
    const existing = await db.notification.findMany({
      where: { dedupeKey: input.dedupeKey, userId: { in: targetIds }, readAt: null },
      select: { userId: true },
    });
    const skip = new Set(existing.map((row) => row.userId));
    eligibleIds = targetIds.filter((id) => !skip.has(id));
  }
  if (eligibleIds.length === 0) return 0;

  const result = await db.notification.createMany({
    data: eligibleIds.map((userId) => ({
      userId,
      type: input.type,
      severity: input.severity ?? NotificationSeverity.INFO,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })),
  });

  if (result.count > 0 && shouldSendTelegramForNotification(input.type)) {
    await sendTelegramNotification({
      type: input.type,
      severity: input.severity ?? NotificationSeverity.INFO,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    }).catch((error) => {
      console.warn("[notifications] Telegram delivery skipped/failed:", error instanceof Error ? error.message : "unknown");
    });
  }

  return result.count;
}

export type NotificationListItem = {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function listNotifications(
  userId: string,
  options: { take?: number; unreadOnly?: boolean } = {},
): Promise<NotificationListItem[]> {
  const take = Math.min(Math.max(options.take ?? DEFAULT_LIST_TAKE, 1), MAX_LIST_TAKE);
  return db.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  // Scope by userId so a user can only mark their own notifications.
  await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
