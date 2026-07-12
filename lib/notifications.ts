import { db } from "@/lib/db";
import { NotificationSeverity, NotificationType, Role } from "@/lib/generated/prisma";
import { buildOutOfStockProductsWhere } from "@/lib/out-of-stock-products";
import { sendTelegramNotification, shouldSendTelegramForNotification } from "@/lib/telegram";
import { formatDateThai, formatDateTimeThai, getThailandDateKey } from "@/lib/th-date";

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

const MESSENGER_PREVIEW_MAX_LENGTH = 80;

function messengerPreview(text?: string | null, messageType?: string | null): string {
  const trimmed = text?.trim();
  if (trimmed) {
    return trimmed.length > MESSENGER_PREVIEW_MAX_LENGTH
      ? `${trimmed.slice(0, MESSENGER_PREVIEW_MAX_LENGTH)}…`
      : trimmed;
  }
  return messageType === "IMAGE" ? "[รูปภาพ]" : "[ข้อความใหม่]";
}

/** A brand-new Messenger customer just started a conversation. */
export async function notifyMessengerNewConversation(input: {
  conversationId: string;
  displayName?: string | null;
  text?: string | null;
}): Promise<number> {
  const who = input.displayName?.trim() || "ลูกค้า Messenger";
  return createNotification({
    type: NotificationType.MESSENGER_NEW_CONVERSATION,
    severity: NotificationSeverity.INFO,
    title: "ลูกค้า Messenger ทักครั้งแรก",
    body: `${who}: ${messengerPreview(input.text)}`,
    link: `/admin/messenger-conversations/${input.conversationId}`,
    entityType: "MessengerConversation",
    entityId: input.conversationId,
    dedupeKey: `messenger-new:${input.conversationId}`,
  });
}

/** A Messenger customer sent a payment slip that needs admin review. */
export async function notifyMessengerPaymentSlip(input: {
  conversationId: string;
  displayName?: string | null;
}): Promise<number> {
  const who = input.displayName?.trim() || "ลูกค้า Messenger";
  return createNotification({
    type: NotificationType.MESSENGER_PAYMENT_SLIP,
    severity: NotificationSeverity.WARNING,
    title: "มีสลิปโอนเงินจาก Messenger รอตรวจสอบ",
    body: `${who} ส่งสลิปการชำระเงิน`,
    link: `/admin/messenger-conversations/${input.conversationId}`,
    entityType: "MessengerConversation",
    entityId: input.conversationId,
    dedupeKey: `messenger-slip:${input.conversationId}`,
  });
}

/** The Messenger AI escalated a conversation to a human admin. */
export async function notifyMessengerNeedsAdmin(input: {
  conversationId: string;
  displayName?: string | null;
  text?: string | null;
  messageType?: string | null;
}): Promise<number> {
  const who = input.displayName?.trim() || "ลูกค้า Messenger";
  return createNotification({
    type: NotificationType.MESSENGER_HANDOFF,
    severity: NotificationSeverity.WARNING,
    title: "ลูกค้า Messenger รอแอดมินตอบ",
    body: `${who}: ${messengerPreview(input.text, input.messageType)}`,
    link: `/admin/messenger-conversations/${input.conversationId}`,
    entityType: "MessengerConversation",
    entityId: input.conversationId,
    dedupeKey: `messenger-handoff:${input.conversationId}`,
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

/** Divider matching the shared Telegram header rule. */
const STOCK_OUT_DIVIDER = "━━━━━━━━━━━━━━━";

export type OutOfStockProduct = {
  code: string;
  name: string;
  categoryName: string;
};

/**
 * Builds the daily out-of-stock digest body. Grouped by category with a clear
 * category header (`🟠 หมวด · N รายการ`) and one product per line (`รหัส · ชื่อ`),
 * blank line between category groups so long product names stay readable.
 * Plain text + emoji only: `sendTelegramMessage` sends without `parse_mode`,
 * so Telegram would render HTML/Markdown tags literally. Kept separate from the
 * sender so it can be unit-inspected. Products are assumed pre-sorted by
 * category then code.
 */
export function buildOutOfStockDigestBody(products: OutOfStockProduct[], at: Date): string {
  const countByCategory = new Map<string, number>();
  for (const product of products) {
    countByCategory.set(product.categoryName, (countByCategory.get(product.categoryName) ?? 0) + 1);
  }

  const lines: string[] = [
    `📅 ${formatDateThai(at)} · 18:30 น.`,
    `รวม ${products.length} รายการ ที่ต้องสั่งเพิ่ม`,
    STOCK_OUT_DIVIDER,
  ];

  let currentCategory: string | null = null;
  let indexInCategory = 0;
  for (const product of products) {
    if (product.categoryName !== currentCategory) {
      if (currentCategory !== null) lines.push("");
      currentCategory = product.categoryName;
      indexInCategory = 0;
      lines.push(`🟠 ${currentCategory} · ${countByCategory.get(currentCategory) ?? 0} รายการ`);
    }
    indexInCategory += 1;
    lines.push(`${indexInCategory}.${product.code} · ${product.name}`);
  }

  return lines.join("\n");
}

/**
 * Daily digest of ACTIVE products at zero (or negative) stock, so the shop can
 * reorder. Routes through `createNotification()` → bell + Telegram together
 * (iron rule §8). Caller must wrap in try/catch. No-op when the list is empty.
 */
export async function notifyOutOfStockDaily(products: OutOfStockProduct[], at: Date = new Date()): Promise<number> {
  if (products.length === 0) return 0;

  return createNotification({
    type: NotificationType.STOCK_OUT_DAILY,
    severity: NotificationSeverity.WARNING,
    title: "สินค้าหมดสต๊อก (Stock = 0)",
    body: buildOutOfStockDigestBody(products, at),
    link: "/admin/products?stock=out",
  });
}

export type OutOfStockRealtimeProduct = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
};

/**
 * Real-time alert fired the moment a sale drives an ACTIVE product's stock
 * across zero (was > 0, now <= 0). One notification per product, routed through
 * `createNotification()` → bell + Telegram together (iron rule §8).
 *
 * MUST be called AFTER the sale transaction commits — never inside `dbTx()` —
 * because Telegram is a network call. Caller wraps in try/catch so a delivery
 * failure never affects the committed sale.
 *
 * Deduped per product per Thailand day (`stock-out:<productId>:<dateKey>`): the
 * same product zeroing out repeatedly in one day only alerts once while the
 * previous alert is still unread.
 */
export async function notifyProductOutOfStock(product: OutOfStockRealtimeProduct, at: Date = new Date()): Promise<number> {
  const body = [
    `📦 ${product.name} (${product.code})`,
    `หมวด: ${product.categoryName}`,
    "คงเหลือ: 0 ชิ้น",
    `⏰ ${formatDateTimeThai(at)} น. · จากการขาย`,
  ].join("\n");

  return createNotification({
    type: NotificationType.STOCK_OUT_REALTIME,
    severity: NotificationSeverity.WARNING,
    title: "สินค้าหมดสต๊อก",
    body,
    link: `/admin/products/${product.id}`,
    entityType: "Product",
    entityId: product.id,
    dedupeKey: `stock-out:${product.id}:${getThailandDateKey(at)}`,
  });
}

/**
 * Post-commit dispatcher for real-time out-of-stock alerts. Given the productIds
 * that crossed zero during a just-committed sale, loads the display fields with a
 * single indexed `IN` query (only the crossed products — usually 0-1) and fires
 * one deduped alert per still-active product. No-op on an empty list. Safe to
 * call fire-and-forget; the caller should wrap in try/catch.
 */
export async function dispatchOutOfStockAlerts(productIds: string[], at: Date = new Date()): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds));
  if (uniqueIds.length === 0) return;

  const products = await db.product.findMany({
    where: { ...buildOutOfStockProductsWhere(), id: { in: uniqueIds } },
    select: { id: true, code: true, name: true, category: { select: { name: true } } },
  });

  for (const product of products) {
    await notifyProductOutOfStock(
      { id: product.id, code: product.code, name: product.name, categoryName: product.category.name },
      at,
    );
  }
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
