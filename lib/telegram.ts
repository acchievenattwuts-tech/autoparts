import { NotificationSeverity, NotificationType } from "@/lib/generated/prisma";

const TELEGRAM_SEND_MESSAGE_URL = "https://api.telegram.org/bot";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Thai-language labels for every NotificationType — used in the Telegram
 * "type:" line so admins reading the chat see a readable Thai description
 * instead of the raw enum name.
 */
const notificationTypeThaiLabel: Record<NotificationType, string> = {
  GENERAL: "แจ้งเตือนทั่วไป",
  SHOPEE_ORDER_IMPORTED: "นำเข้าออเดอร์ Shopee สำเร็จ",
  SHOPEE_ORDER_FAILED: "นำเข้าออเดอร์ Shopee ล้มเหลว",
  SHOPEE_STOCK_SYNC_FAILED: "ซิงค์สต็อก Shopee ล้มเหลว",
  SHOPEE_TOKEN_EXPIRING: "Token Shopee ใกล้หมดอายุ",
  SHOPEE_AUTH_REVOKED: "การเชื่อมต่อ Shopee ถูกยกเลิก",
  SHOPEE_RETURN_REVIEW: "Shopee คืนสินค้า ต้องตรวจสอบ",
  SHOPEE_DELIVERY_EXCEPTION: "Shopee มีปัญหาจัดส่ง",
  LINE_OA_HANDOFF: "ลูกค้า LINE OA รอแอดมินตอบ",
  LINE_NEW_CUSTOMER: "ลูกค้าใหม่จาก LINE",
  LINE_OLD_CUSTOMER_LINKED: "ลูกค้าเก่าผูก LINE",
  LINE_OLD_CUSTOMER_RELINKED: "ลูกค้าเก่าผูก LINE ใหม่",
};

export function getNotificationTypeThaiLabel(type: NotificationType): string {
  return notificationTypeThaiLabel[type] ?? type;
}

export type TelegramConfig = {
  botToken: string | null;
  chatIds: string[];
  missingEnv: string[];
};

export type TelegramNotificationPayload = {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string | null;
  link?: string | null;
};

function normalizeEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseChatIds(value: string | undefined): string[] {
  const raw = normalizeEnv(value);
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

export function getTelegramConfig(): TelegramConfig {
  const botToken = normalizeEnv(process.env.TELEGRAM_BOT_TOKEN);
  const chatIds = parseChatIds(process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID);
  const missingEnv: string[] = [];

  if (!botToken) missingEnv.push("TELEGRAM_BOT_TOKEN");
  if (chatIds.length === 0) missingEnv.push("TELEGRAM_CHAT_IDS");

  return { botToken, chatIds, missingEnv };
}

export function shouldSendTelegramForNotification(type: NotificationType): boolean {
  // Iron rule: every notification type that admins see in the bell MUST also send
  // Telegram. The only exception is GENERAL (a free-form catch-all for internal
  // dev notes, never a real customer event).
  return type !== NotificationType.GENERAL;
}

function severityLabel(severity: NotificationSeverity): string {
  switch (severity) {
    case NotificationSeverity.ERROR:
      return "ERROR";
    case NotificationSeverity.WARNING:
      return "WARNING";
    default:
      return "INFO";
  }
}

export function buildTelegramNotificationText(payload: TelegramNotificationPayload, appBaseUrl?: string | null): string {
  const lines = [
    `[${severityLabel(payload.severity)}] ${payload.title}`,
    payload.body?.trim() || null,
    `ประเภท: ${getNotificationTypeThaiLabel(payload.type)}`,
  ];

  const base = appBaseUrl?.replace(/\/+$/, "");
  if (payload.link) {
    const href = payload.link.startsWith("http")
      ? payload.link
      : base
        ? `${base}${payload.link.startsWith("/") ? "" : "/"}${payload.link}`
        : payload.link;
    lines.push(`ลิงก์: ${href}`);
  }

  return lines.filter(Boolean).join("\n").slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
}

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<void> {
  const response = await fetch(`${TELEGRAM_SEND_MESSAGE_URL}${encodeURIComponent(params.botToken)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: params.chatId,
      text: params.text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
  }
}

export async function sendTelegramNotification(payload: TelegramNotificationPayload): Promise<{ sentCount: number; skippedReason?: string }> {
  if (!shouldSendTelegramForNotification(payload.type)) {
    return { sentCount: 0, skippedReason: "NOT_SHOPEE_NOTIFICATION" };
  }

  const config = getTelegramConfig();
  if (!config.botToken || config.chatIds.length === 0) {
    return { sentCount: 0, skippedReason: `CONFIG_INCOMPLETE:${config.missingEnv.join(",")}` };
  }

  const appBaseUrl =
    normalizeEnv(process.env.APP_BASE_URL) ??
    normalizeEnv(process.env.NEXTAUTH_URL) ??
    normalizeEnv(process.env.NEXT_PUBLIC_APP_URL);
  const text = buildTelegramNotificationText(payload, appBaseUrl);

  for (const chatId of config.chatIds) {
    await sendTelegramMessage({ botToken: config.botToken, chatId, text });
  }

  return { sentCount: config.chatIds.length };
}

