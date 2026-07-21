import { LineMessageType, NotificationSeverity, NotificationType } from "@/lib/generated/prisma";
import { formatDateTimeThai } from "@/lib/th-date";

const TELEGRAM_SEND_MESSAGE_URL = "https://api.telegram.org/bot";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_SEND_MAX_ATTEMPTS = 3;
const TELEGRAM_RETRY_DELAYS_MS = [250, 750] as const;

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
  MESSENGER_NEW_CONVERSATION: "ลูกค้า Messenger ทักครั้งแรก",
  MESSENGER_PAYMENT_SLIP: "สลิปโอนเงินจาก Messenger รอตรวจสอบ",
  MESSENGER_HANDOFF: "ลูกค้า Messenger รอแอดมินตอบ",
  STOCK_OUT_DAILY: "สินค้าหมดสต๊อก (แจ้งเตือนประจำวัน)",
  STOCK_OUT_REALTIME: "สินค้าหมดสต๊อก (เรียลไทม์จากการขาย)",
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

/** Shared horizontal rule under the header line for every Telegram message. */
const TELEGRAM_DIVIDER = "━━━━━━━━━━━━━━━";

/** Emoji that fronts each notification type's header line, so admins can tell
 *  the category apart at a glance in the Telegram feed. */
const notificationTypeEmoji: Record<NotificationType, string> = {
  GENERAL: "📢",
  SHOPEE_ORDER_IMPORTED: "🛒",
  SHOPEE_ORDER_FAILED: "❌",
  SHOPEE_STOCK_SYNC_FAILED: "🔄",
  SHOPEE_TOKEN_EXPIRING: "🔑",
  SHOPEE_AUTH_REVOKED: "🔌",
  SHOPEE_RETURN_REVIEW: "↩️",
  SHOPEE_DELIVERY_EXCEPTION: "🚚",
  LINE_OA_HANDOFF: "🙋",
  LINE_NEW_CUSTOMER: "🆕",
  LINE_OLD_CUSTOMER_LINKED: "🔗",
  LINE_OLD_CUSTOMER_RELINKED: "🔗",
  MESSENGER_NEW_CONVERSATION: "💬",
  MESSENGER_PAYMENT_SLIP: "🧾",
  MESSENGER_HANDOFF: "🙋",
  STOCK_OUT_DAILY: "🔴",
  STOCK_OUT_REALTIME: "🔴",
};

/** Footer tag flagging urgency — only for WARNING/ERROR so routine INFO stays
 *  clean. */
function severityTag(severity: NotificationSeverity): string | null {
  switch (severity) {
    case NotificationSeverity.ERROR:
      return "🔴 ด่วน";
    case NotificationSeverity.WARNING:
      return "🟡 ต้องตรวจสอบ";
    default:
      return null;
  }
}

export function buildTelegramNotificationText(payload: TelegramNotificationPayload, appBaseUrl?: string | null): string {
  const emoji = notificationTypeEmoji[payload.type] ?? "📢";
  const lines: (string | null)[] = [
    `${emoji} ${payload.title}`,
    TELEGRAM_DIVIDER,
    payload.body?.trim() || null,
  ];

  const base = appBaseUrl?.replace(/\/+$/, "");
  const href = payload.link
    ? payload.link.startsWith("http")
      ? payload.link
      : base
        ? `${base}${payload.link.startsWith("/") ? "" : "/"}${payload.link}`
        : payload.link
    : null;

  const tag = severityTag(payload.severity);
  // Blank separator before the footer block, only when there is a footer.
  if (tag || href) lines.push("");
  if (tag) lines.push(tag);
  if (href) lines.push(`🔗 ดูรายละเอียด: ${href}`);

  return lines.filter((line) => line !== null).join("\n").slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
}

class TelegramHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "TelegramHttpError";
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableTelegramError(error: unknown): boolean {
  if (error instanceof TelegramHttpError) return error.status === 429 || error.status >= 500;
  // fetch network/DNS/connection errors are not HTTP errors and are generally transient.
  return true;
}

async function sendTelegramMessageOnce(params: {
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
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1_000, 2_000)
        : null;
    throw new TelegramHttpError(
      `Telegram sendMessage failed (${response.status}): ${body}`,
      response.status,
      retryAfterMs,
    );
  }
}

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TELEGRAM_SEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      await sendTelegramMessageOnce(params);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= TELEGRAM_SEND_MAX_ATTEMPTS || !isRetryableTelegramError(error)) throw error;
      const retryAfterMs = error instanceof TelegramHttpError ? error.retryAfterMs : null;
      await wait(retryAfterMs ?? TELEGRAM_RETRY_DELAYS_MS[attempt - 1] ?? 750);
    }
  }
  throw lastError;
}

/** One-line label for an inbound LINE message in the Telegram mirror. Image /
 *  sticker turns carry no text, so they show a readable placeholder instead. */
function lineMirrorBody(messageType: LineMessageType, text: string | null): string {
  switch (messageType) {
    case LineMessageType.IMAGE:
      return "🖼️ [ส่งรูปภาพ]";
    case LineMessageType.STICKER:
      return "😊 [ส่งสติกเกอร์]";
    default:
      return text?.trim() || "[ข้อความ]";
  }
}

export function buildLineMirrorText(params: {
  displayName: string | null;
  messageType: LineMessageType;
  text: string | null;
  at: Date;
}): string {
  const who = params.displayName?.trim() || "ลูกค้า LINE";
  const when = formatDateTimeThai(params.at);
  const body = lineMirrorBody(params.messageType, params.text);
  return [
    "💬 ข้อความใหม่จาก LINE OA",
    TELEGRAM_DIVIDER,
    `👤 ${who}`,
    `🕐 ${when} น.`,
    "",
    body,
  ]
    .join("\n")
    .slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
}

/**
 * Mirrors a single inbound LINE customer message to Telegram as a raw chat
 * relay — deliberately NOT routed through `createNotification()` / the bell.
 * The §8 "bell + Telegram together" iron rule covers admin *alert events*;
 * this is a live read-only mirror of every customer message, which would only
 * flood the in-app bell. It therefore sends Telegram-only, on purpose.
 * Fire-and-forget at the call site: a Telegram failure must never break the
 * LINE webhook flow. Silently skips when Telegram env vars are unset.
 */
export async function mirrorLineMessageToTelegram(params: {
  displayName: string | null;
  messageType: LineMessageType;
  text: string | null;
  at: Date;
}): Promise<{ sentCount: number; skippedReason?: string }> {
  const config = getTelegramConfig();
  if (!config.botToken || config.chatIds.length === 0) {
    return { sentCount: 0, skippedReason: `CONFIG_INCOMPLETE:${config.missingEnv.join(",")}` };
  }

  const text = buildLineMirrorText(params);
  for (const chatId of config.chatIds) {
    await sendTelegramMessage({ botToken: config.botToken, chatId, text });
  }

  return { sentCount: config.chatIds.length };
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

