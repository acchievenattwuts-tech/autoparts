import {
  DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON, DELIVERY_CARD_MAX_SALE_AGE_DAYS, SALE_TOO_OLD_SKIP_REASON,
} from "@/lib/line-delivery-policy";

/**
 * Admin-facing Thai wording for LINE delivery-card dispatch outcomes. Shared by
 * the sale detail status badge and the LINE_DELIVERY_FAILED bell/Telegram alert,
 * so both always explain an error code the same way.
 */

const LINE_DELIVERY_REASON_LABEL: Record<string, string> = {
  // Skip reasons (policy / worker pre-send check)
  SETTING_DISABLED: "ปิดการแจ้งเตือนอยู่",
  DISABLED_BEFORE_DISPATCH: "ปิดการแจ้งเตือนก่อนส่ง",
  SALE_INACTIVE: "บิลถูกยกเลิก",
  MARKETPLACE_CHANNEL: "บิลจากช่องทางออนไลน์",
  NOT_SELF_DELIVERY: "ไม่ได้จัดส่งโดยร้าน",
  [SALE_TOO_OLD_SKIP_REASON]: `บิลเก่าเกิน ${DELIVERY_CARD_MAX_SALE_AGE_DAYS} วัน`,
  CUSTOMER_NOT_LINKED: "ลูกค้ายังไม่ได้ผูก LINE",
  RECIPIENT_CHANGED: "ลูกค้าหรือบัญชี LINE เปลี่ยน",
  ALREADY_DELIVERED: "แจ้งส่งสำเร็จไปแล้ว",
  [DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON]: "แจ้งส่งสำเร็จอาจถึงลูกค้าแล้ว (ไม่ทราบผลการส่ง)",
  STALE_STATUS: "สถานะเปลี่ยนก่อนส่ง",
  INVALID_EVENT: "สถานะไม่รองรับ",
  // Terminal failure codes (enqueue / worker / transport)
  INVALID_APP_URL: "ตั้งค่า URL ของระบบไม่ถูกต้อง",
  LINE_CONFIG_MISSING: "ยังไม่ได้ตั้งค่า LINE Messaging API หรือไม่มีผู้รับ",
  LEASE_EXPIRED: "ระบบหยุดระหว่างส่ง ไม่ทราบผลการส่ง",
  // Legacy: written only by the retry policy that ended with owner decision T6.
  RETRY_WINDOW_EXPIRED: "ลองส่งซ้ำครบ 24 ชั่วโมงแล้ว",
  INVALID_PAYLOAD: "ข้อมูลการ์ดไม่ถูกต้อง",
  LINE_NETWORK_ERROR: "เชื่อมต่อ LINE ไม่ได้",
  DISPATCH_PROCESSING_ERROR: "ระบบประมวลผลผิดพลาด",
  LINE_HTTP_401: "Token ของ LINE ไม่ถูกต้องหรือหมดอายุ",
  LINE_HTTP_429: "LINE จำกัดจำนวนการส่งข้อความ",
};

const LINE_HTTP_ERROR_PATTERN = /^LINE_HTTP_(\d{3})$/;

/** Thai reason for a dispatch skip or failure code; unknown codes are shown as-is. */
export const getLineDeliveryReasonLabel = (code: string | null): string => {
  if (!code) return "ไม่ทราบสาเหตุ";
  const known = LINE_DELIVERY_REASON_LABEL[code];
  if (known) return known;
  const httpStatus = LINE_HTTP_ERROR_PATTERN.exec(code)?.[1];
  if (httpStatus) return `LINE ตอบกลับข้อผิดพลาด (HTTP ${httpStatus})`;
  return `รหัส ${code}`;
};

export type LineDeliveryBadgeTone = "success" | "muted" | "danger" | "info";

export type LineDeliveryBadge = { eventLabel: string; statusLabel: string; tone: LineDeliveryBadgeTone };

const LINE_DELIVERY_EVENT_LABEL: Record<string, string> = {
  OUT_FOR_DELIVERY: "แจ้งออกส่ง",
  DELIVERED: "แจ้งส่งสำเร็จ",
};

const LINE_DELIVERY_EVENT_ORDER = ["OUT_FOR_DELIVERY", "DELIVERED"];

const toBadgeStatus = (state: string, lastErrorCode: string | null): Pick<LineDeliveryBadge, "statusLabel" | "tone"> => {
  switch (state) {
    case "ACCEPTED":
      return { statusLabel: "ส่งแล้ว", tone: "success" };
    case "SKIPPED":
      return { statusLabel: `ข้าม (${getLineDeliveryReasonLabel(lastErrorCode)})`, tone: "muted" };
    case "FAILED":
      return { statusLabel: `ส่งไม่สำเร็จ (${getLineDeliveryReasonLabel(lastErrorCode)})`, tone: "danger" };
    default:
      // PENDING (not attempted yet) and PROCESSING (the single attempt in flight).
      return { statusLabel: "กำลังส่ง", tone: "info" };
  }
};

/** Screen-only badges for a sale's delivery-card dispatches, ordered by event. */
export const buildLineDeliveryBadges = (
  dispatches: Array<{ eventStatus: string; state: string; lastErrorCode: string | null }>,
): LineDeliveryBadge[] =>
  [...dispatches]
    .sort((a, b) => LINE_DELIVERY_EVENT_ORDER.indexOf(a.eventStatus) - LINE_DELIVERY_EVENT_ORDER.indexOf(b.eventStatus))
    .map((dispatch) => ({
      eventLabel: LINE_DELIVERY_EVENT_LABEL[dispatch.eventStatus] ?? dispatch.eventStatus,
      ...toBadgeStatus(dispatch.state, dispatch.lastErrorCode),
    }));
