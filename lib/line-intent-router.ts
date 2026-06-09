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
const PURCHASE_INTENT_RE =
  /(เอาตัวนี้|เอาอันนี้|เอาเลย|จะเอา|เอากี่|เอา\s*\d|สั่งซื้อ|สั่งเลย|สั่งของ|ขอสั่ง|ซื้อเลย|ขอซื้อ|จะซื้อ|กี่บาท|ราคาเท่าไ|รวมส่ง|ค่าส่งเท่าไ|เก็บปลายทาง|เก็บเงินปลายทาง|โอนเข้าไหน|โอนยังไง|เลขบัญชี|เลขที่บัญชี|รับของยังไง|order now|check ?out)/i;
const SHOP_INFO_RE =
  /(เวลาทำการ|เวลาเปิด|เปิดกี่โมง|กี่โมง|ปิดกี่โมง|เปิดไหม|ปิดไหม|หยุดไหม|วันหยุด|ติดต่อร้าน|ติดต่อสอบถาม|ขอสอบถามข้อมูล|เบอร์โทร|เบอร์ร้าน|ร้านอยู่ไหน|ร้านอยู่ที่ไหน|อยู่ที่ไหน|อยู่ตรงไหน|อยู่ไหน|ที่ตั้งร้าน|ที่ตั้ง|พิกัด|แผนที่|ไปร้าน|ไปยังไง|ไปไง|มีหน้าร้าน|มีสาขา|สาขา|location|map)/i;
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

  if (PURCHASE_INTENT_RE.test(normalized)) {
    return {
      intent: LineIntent.PURCHASE_INTENT,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "PURCHASE_INTENT_KEYWORD",
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

  if (SHOP_INFO_RE.test(normalized)) {
    return {
      intent: LineIntent.SHOP_INFO,
      allowsSearch: false,
      requiresAdmin: false,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "SHOP_INFO_KEYWORD",
    };
  }

  // Default: in a parts shop, any freeform message that isn't one of the special
  // admin intents (payment/shipping/claim/price/order) or a greeting/menu is most
  // likely a product question (e.g. a Thai part name or car model not in the hint
  // list). Try a catalog search rather than silently handing off to an admin — a
  // weak/empty result degrades to a polite "ask for more info" downstream.
  return {
    intent: LineIntent.PRODUCT_INQUIRY_TEXT,
    allowsSearch: true,
    requiresAdmin: false,
    requiresImageAnalysis: false,
    requiresMoreInfo: false,
    reason: "DEFAULT_PRODUCT_INQUIRY",
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
