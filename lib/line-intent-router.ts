import { LineIntent, LineMessageType } from "@/lib/generated/prisma";

export type LineIntentRouteInput = {
  messageType: LineMessageType;
  text?: string | null;
};

export type LineIntentRouteResult = {
  intent: LineIntent;
  allowsSearch: boolean;
  requiresAdmin: boolean;
  requiresImageAnalysis: boolean;
  requiresMoreInfo: boolean;
  reason: string;
};

const GREETING_RE = /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello\b|hi\b)/i;
const PAYMENT_RE = /(สลิป|โอน|โอนแล้ว|ชำระ|จ่ายแล้ว|ยอดเงิน|ธนาคาร|พร้อมเพย์|promptpay|transfer|slip)/i;
const SHIPPING_ADDRESS_RE = /(ที่อยู่|จัดส่ง|ส่งของ|ปลายทาง|ตำบล|อำเภอ|จังหวัด|รหัสไปรษณีย์|postcode|address)/i;
const ORDER_STATUS_RE = /(สถานะ|เลขพัสดุ|ติดตาม|tracking|ของถึง|ส่งหรือยัง|ออเดอร์|order)/i;
const PRICE_NEGOTIATION_RE = /(ลดได้ไหม|ลดหน่อย|ต่อราคา|แพง|ราคาสุด|ขอราคา|ส่วนลด|discount)/i;
const CLAIM_RE = /(เคลม|คืนของ|คืนสินค้า|เสีย|พัง|ชำรุด|เปลี่ยนสินค้า|รับประกัน|claim|return)/i;
const CUSTOMER_MENU_RE = /(เมนู|เวลาทำการ|ติดต่อร้าน|ติดต่อสอบถาม|หาอะไหล่|สอบถามอะไหล่)/i;
const PRODUCT_HINT_RE =
  /(คอมแอร์|คอมเพรสเซอร์|แผงแอร์|คอยล์เย็น|วาล์ว|ไดเออร์|โบลเวอร์|พัดลม|กรองแอร์|หม้อน้ำ|อะไหล่|เบอร์|รุ่น|ปี|รถ|vios|city|jazz|civic|altis|toyota|honda|isuzu|mazda|nissan|mitsubishi|\b[a-z0-9-]*\d[a-z0-9-]*\b)/i;

function routeText(text: string): LineIntentRouteResult {
  const normalized = text.trim();
  if (!normalized) {
    return {
      intent: LineIntent.UNKNOWN,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: true,
      reason: "EMPTY_TEXT",
    };
  }

  if (PAYMENT_RE.test(normalized)) {
    return {
      intent: LineIntent.PAYMENT_SLIP_IMAGE,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "PAYMENT_KEYWORD",
    };
  }

  if (SHIPPING_ADDRESS_RE.test(normalized)) {
    return {
      intent: LineIntent.SHIPPING_ADDRESS,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "SHIPPING_ADDRESS_KEYWORD",
    };
  }

  if (CLAIM_RE.test(normalized)) {
    return {
      intent: LineIntent.CLAIM_OR_RETURN,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "CLAIM_KEYWORD",
    };
  }

  if (PRICE_NEGOTIATION_RE.test(normalized)) {
    return {
      intent: LineIntent.PRICE_NEGOTIATION,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "PRICE_NEGOTIATION_KEYWORD",
    };
  }

  if (ORDER_STATUS_RE.test(normalized)) {
    return {
      intent: LineIntent.ORDER_STATUS,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "ORDER_STATUS_KEYWORD",
    };
  }

  if (GREETING_RE.test(normalized)) {
    return {
      intent: LineIntent.GREETING,
      allowsSearch: false,
      requiresAdmin: false,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "GREETING",
    };
  }

  if (CUSTOMER_MENU_RE.test(normalized)) {
    return {
      intent: LineIntent.UNKNOWN,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "CUSTOMER_MENU_KEYWORD",
    };
  }

  if (PRODUCT_HINT_RE.test(normalized)) {
    return {
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      allowsSearch: true,
      requiresAdmin: false,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "PRODUCT_HINT",
    };
  }

  return {
    intent: LineIntent.UNKNOWN,
    allowsSearch: false,
    requiresAdmin: true,
    requiresImageAnalysis: false,
    requiresMoreInfo: true,
    reason: "NO_ROUTING_RULE_MATCH",
  };
}

export function routeLineIntent(input: LineIntentRouteInput): LineIntentRouteResult {
  if (input.messageType === LineMessageType.IMAGE) {
    return {
      intent: LineIntent.PART_IMAGE_INQUIRY,
      allowsSearch: false,
      requiresAdmin: false,
      requiresImageAnalysis: true,
      requiresMoreInfo: false,
      reason: "IMAGE_REQUIRES_CLASSIFICATION",
    };
  }

  if (input.messageType === LineMessageType.TEXT || input.messageType === LineMessageType.POSTBACK) {
    return routeText(input.text ?? "");
  }

  if (input.messageType === LineMessageType.FOLLOW) {
    return {
      intent: LineIntent.GREETING,
      allowsSearch: false,
      requiresAdmin: false,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "FOLLOW_EVENT",
    };
  }

  return {
    intent: LineIntent.UNKNOWN,
    allowsSearch: false,
    requiresAdmin: true,
    requiresImageAnalysis: false,
    requiresMoreInfo: true,
    reason: "UNSUPPORTED_MESSAGE_TYPE",
  };
}
