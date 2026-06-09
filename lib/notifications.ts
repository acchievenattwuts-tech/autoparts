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

const LINE_OA_PREVIEW_MAX_LENGTH = 80;

/**
 * Notifies all admins that a LINE OA customer is waiting for a human reply.
 * Fired whenever the AI agent does NOT auto-reply successfully (handoff, AI off,
 * dry-run, paused/waiting conversation, or failed delivery).
 *
 * Deduped per conversation: only one UNREAD notification exists at a time, so a
 * burst of customer messages never spams the bell. A fresh row is created again
 * once every admin has read the previous one. In-app only (no Telegram).
 */
export async function notifyLineOaNeedsAdmin(input: {
  conversationId: string;
  displayName?: string | null;
  text?: string | null;
  messageType?: string | null;
  /** When > 0, the title is suffixed with "(มีสลิปรอตรวจสอบ)" so admins can
   * triage payment-slip cases without opening the conversation. */
  pendingSlipCount?: number;
}): Promise<number> {
  const who = input.displayName?.trim() || "ลูกค้า LINE";
  const trimmed = input.text?.trim();
  const preview = trimmed
    ? trimmed.length > LINE_OA_PREVIEW_MAX_LENGTH
      ? `${trimmed.slice(0, LINE_OA_PREVIEW_MAX_LENGTH)}…`
      : trimmed
    : input.messageType === "IMAGE"
      ? "[รูปภาพ]"
      : input.messageType === "STICKER"
        ? "[สติกเกอร์]"
        : "[ข้อความใหม่]";

  const slipSuffix = (input.pendingSlipCount ?? 0) > 0 ? " (มีสลิปรอตรวจสอบ)" : "";

  return createNotification({
    type: NotificationType.LINE_OA_HANDOFF,
    severity: NotificationSeverity.WARNING,
    title: `ลูกค้า LINE OA รอแอดมินตอบ${slipSuffix}`,
    body: `${who}: ${preview}`,
    link: `/admin/line-conversations/${input.conversationId}`,
    entityType: "LineConversation",
    entityId: input.conversationId,
    dedupeKey: `line-oa-handoff:${input.conversationId}`,
  });
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

/**
 * LINE customer-linkage notification kinds (mirrors the API derived linkKind).
 */
export type LineCustomerLinkKind =
  | "LINE_NEW_CUSTOMER"
  | "LINE_OLD_CUSTOMER_LINKED"
  | "LINE_OLD_CUSTOMER_RELINKED";

const lineCustomerNotificationConfig: Record<
  LineCustomerLinkKind,
  { type: NotificationType; title: string; severity: NotificationSeverity }
> = {
  LINE_NEW_CUSTOMER: {
    type: NotificationType.LINE_NEW_CUSTOMER,
    title: "ลูกค้าใหม่จาก LINE",
    severity: NotificationSeverity.INFO,
  },
  LINE_OLD_CUSTOMER_LINKED: {
    type: NotificationType.LINE_OLD_CUSTOMER_LINKED,
    title: "ลูกค้าเก่าผูก LINE",
    severity: NotificationSeverity.INFO,
  },
  LINE_OLD_CUSTOMER_RELINKED: {
    type: NotificationType.LINE_OLD_CUSTOMER_RELINKED,
    title: "ลูกค้าเก่าผูก LINE ใหม่",
    severity: NotificationSeverity.WARNING,
  },
};

/**
 * Notifies admins when a customer links/relinks/registers via LINE. Fires the
 * in-app bell (Notification table) AND Telegram in one call — never call only
 * one half (iron rule §8: notifications are always paired).
 *
 * Deduped per customer so a quick double-tap (e.g., link + immediate profile
 * update) doesn't create duplicate unread rows.
 */
export async function notifyLineCustomerLinked(input: {
  kind: LineCustomerLinkKind;
  customerId: string;
  customerName: string;
  customerCode?: string | null;
  phone?: string | null;
}): Promise<number> {
  const config = lineCustomerNotificationConfig[input.kind];
  const bodyParts = [input.customerName];
  if (input.customerCode) bodyParts.push(input.customerCode);
  if (input.phone) bodyParts.push(input.phone);

  return createNotification({
    type: config.type,
    severity: config.severity,
    title: config.title,
    body: bodyParts.join(" · "),
    link: `/admin/customers/${input.customerId}`,
    entityType: "Customer",
    entityId: input.customerId,
    dedupeKey: `line-customer-link:${input.customerId}:${input.kind}`,
  });
}

/**
 * Cleanup job: deletes read notifications older than 30 days. Runs nightly.
 * Returns the count of deleted rows.
 */
export async function cleanupOldNotifications(daysOld = 30): Promise<number> {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const result = await db.notification.deleteMany({
    where: {
      readAt: { not: null }, // only read notifications
      createdAt: { lt: cutoffDate }, // older than daysOld
    },
  });
  return result.count;
}
