import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { detectAdminOnlyKnowledgeMatch } from "@/lib/chat-core/admin-only-knowledge";
import { detectChatIntentTypo } from "@/lib/chat-core/intent-typo-guard";

const SERVICE_INQUIRY_SAFE_RE = new RegExp(
  [
    "(?:\\u0e23\\u0e31\\u0e1a\\s*(?:\\u0e2d\\u0e31\\u0e14|\\u0e17\\u0e33|\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e40\\u0e15\\u0e34\\u0e21|\\u0e25\\u0e49\\u0e32\\u0e07|\\u0e15\\u0e34\\u0e14\\u0e15\\u0e31\\u0e49\\u0e07)|(?:\\u0e2d\\u0e31\\u0e14|\\u0e17\\u0e33|\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e40\\u0e15\\u0e34\\u0e21|\\u0e25\\u0e49\\u0e32\\u0e07|\\u0e15\\u0e34\\u0e14\\u0e15\\u0e31\\u0e49\\u0e07)\\s*(?:\\u0e2a\\u0e32\\u0e22\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e19\\u0e49(?:\\u0e33|\\u0e4d\\u0e32)\\u0e22\\u0e32\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16\\u0e22\\u0e19\\u0e15\\u0e4c)|\\u0e23\\u0e31\\u0e1a\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e23\\u0e31\\u0e1a\\u0e17\\u0e33).*(?:\\u0e2a\\u0e32\\u0e22\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e19\\u0e49(?:\\u0e33|\\u0e4d\\u0e32)\\u0e22\\u0e32\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16\\u0e22\\u0e19\\u0e15\\u0e4c)",
    "(?:\\u0e2a\\u0e32\\u0e22\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e19\\u0e49(?:\\u0e33|\\u0e4d\\u0e32)\\u0e22\\u0e32\\u0e41\\u0e2d\\u0e23\\u0e4c|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16|\\u0e41\\u0e2d\\u0e23\\u0e4c\\u0e23\\u0e16\\u0e22\\u0e19\\u0e15\\u0e4c).*(?:\\u0e23\\u0e31\\u0e1a\\s*(?:\\u0e2d\\u0e31\\u0e14|\\u0e17\\u0e33|\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e40\\u0e15\\u0e34\\u0e21|\\u0e25\\u0e49\\u0e32\\u0e07|\\u0e15\\u0e34\\u0e14\\u0e15\\u0e31\\u0e49\\u0e07)|(?:\\u0e2d\\u0e31\\u0e14|\\u0e17\\u0e33|\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e40\\u0e15\\u0e34\\u0e21|\\u0e25\\u0e49\\u0e32\\u0e07|\\u0e15\\u0e34\\u0e14\\u0e15\\u0e31\\u0e49\\u0e07)|\\u0e23\\u0e31\\u0e1a\\u0e0b\\u0e48\\u0e2d\\u0e21|\\u0e23\\u0e31\\u0e1a\\u0e17\\u0e33)",
  ].join("|"),
  "i",
);

const SERVICE_ACTION_RE =
  /\u0e23\u0e31\u0e1a\s*(?:\u0e2d\u0e31\u0e14|\u0e17\u0e33|\u0e0b\u0e48\u0e2d\u0e21|\u0e40\u0e15\u0e34\u0e21|\u0e25\u0e49\u0e32\u0e07|\u0e15\u0e34\u0e14\u0e15\u0e31\u0e49\u0e07)|\u0e2d\u0e31\u0e14|\u0e17\u0e33|\u0e0b\u0e48\u0e2d\u0e21|\u0e40\u0e15\u0e34\u0e21|\u0e25\u0e49\u0e32\u0e07|\u0e15\u0e34\u0e14\u0e15\u0e31\u0e49\u0e07|\u0e23\u0e31\u0e1a\u0e0b\u0e48\u0e2d\u0e21|\u0e23\u0e31\u0e1a\u0e17\u0e33/i;
const SERVICE_TARGET_RE =
  /\u0e2a\u0e32\u0e22\u0e41\u0e2d\u0e23\u0e4c|\u0e19\u0e49(?:\u0e33|\u0e4d\u0e32)\u0e22\u0e32\u0e41\u0e2d\u0e23\u0e4c|\u0e41\u0e2d\u0e23\u0e4c\u0e23\u0e16|\u0e41\u0e2d\u0e23\u0e4c\u0e23\u0e16\u0e22\u0e19\u0e15\u0e4c/i;

function isServiceInquiryText(text: string): boolean {
  return SERVICE_INQUIRY_SAFE_RE.test(text) || (SERVICE_ACTION_RE.test(text) && SERVICE_TARGET_RE.test(text));
}

export type ChatIntentRouteInput = {
  messageType: LineMessageType;
  text?: string | null;
};

export type ChatIntentRouteResult = {
  intent: LineIntent;
  allowsSearch: boolean;
  requiresAdmin: boolean;
  requiresImageAnalysis: boolean;
  requiresMoreInfo: boolean;
  reason: string;
  /**
   * How the rule fired. `"literal"` (the default, and what every pre-existing
   * branch produces) means a regex matched the text as typed. `"typo"` means every
   * literal rule missed and the edit-distance backstop
   * ({@link detectChatIntentTypo}) recognised a mis-keyed high-stakes keyword.
   *
   * `reason` is deliberately IDENTICAL for both, so downstream routing logic in the
   * channel processors needs no change; this field exists purely so the audit trail
   * can measure how often the backstop fires and on what.
   */
  matchedVia?: "literal" | "typo";
  /** The canonical keyword the typo backstop matched. Only set when matchedVia = "typo". */
  matchedTypoKeyword?: string;
};

const GREETING_RE = /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello\b|hi\b)/i;
const PAYMENT_RE = /(สลิป|โอน|โอนแล้ว|ชำระ|จ่ายแล้ว|ยอดเงิน|ธนาคาร|พร้อมเพย์|promptpay|transfer|slip)/i;
// คำถามเชิง "มีบริการส่งไหม / ส่งยังไง / ค่าส่งคิดยังไง" — เป็นคำถามข้อมูลร้าน
// (ไม่ใช่การแจ้งที่อยู่จริง) ให้ตอบเองด้วย SHOP_INFO/FAQ แทนการเด้งแอดมิน ต้อง
// เช็กก่อน SHIPPING_ADDRESS_RE เพราะคำว่า "จัดส่ง/ส่งของ" ซ้อนกันอยู่.
const SHIPPING_SERVICE_INQUIRY_RE =
  /(มีบริการ(จัด)?ส่ง|(จัด)?ส่ง(ของ)?(ได้|ทั่วประเทศ)?\s*(ไหม|มั้ย|หรือเปล่า|รึเปล่า)|ส่งต่างจังหวัด|ส่งทั่วประเทศ|ค่า(จัด)?ส่งคิด(ยังไง|อย่างไร)|(จัด)?ส่งยังไง|ส่งกี่วัน|ส่งนานไหม)/i;
const SHIPPING_ADDRESS_RE =
  /(ที่อยู่|จัดส่ง|ส่งของ|ปลายทาง|ตำบล|อำเภอ|จังหวัด|แขวง|รหัสไปรษณีย์|postcode|address)/i;
// ลูกค้าส่วนใหญ่พิมพ์ที่อยู่แบบย่อ ("55/2 ต.บางม่วง อ.เมือง จ.นครสวรรค์ 60000") ซึ่ง
// ไม่มีคำเต็มให้ SHIPPING_ADDRESS_RE จับเลย ที่อยู่จึงเคยไหลไปเป็นคำค้นสินค้า.
// ภาษาไทยปกติไม่ใช้จุดจบคำ รูปแบบ "อักษรย่อ + จุด + ข้อความ" จึงเป็นสัญญาณที่อยู่ที่
// ค่อนข้างชัด แต่ยังบังคับให้มีสัญญาณอย่างน้อย 2 ตัวก่อนตัดสิน เพื่อไม่ให้รหัสอะไหล่
// หรือข้อความสินค้าที่มีตัวเลข 5 หลักถูกเข้าใจผิดว่าเป็นที่อยู่
const THAI_ADDRESS_ABBREV_RE = /(?:ต|อ|จ|ถ|ซ|ม)\.\s*[ก-๙\d]/g;
const THAI_ADDRESS_WORD_RE = /(แขวง|เขต|หมู่ที่|หมู่บ้าน|ซอย|ถนน|หมู่\s*\d)/;
const THAI_POSTCODE_RE = /(?:^|\D)\d{5}(?:\D|$)/;
function looksLikeThaiPostalAddress(text: string): boolean {
  const abbreviations = text.match(THAI_ADDRESS_ABBREV_RE)?.length ?? 0;
  if (abbreviations >= 2) return true;
  const hasPostcode = THAI_POSTCODE_RE.test(text);
  if (abbreviations >= 1 && hasPostcode) return true;
  return THAI_ADDRESS_WORD_RE.test(text) && (hasPostcode || abbreviations >= 1);
}
// "ขอที่อยู่ร้านหน่อย / ร้านอยู่จังหวัดอะไร" คือคำถามที่ตั้งร้าน ตอบเองได้จาก SiteConfig
// ไม่ใช่การแจ้งที่อยู่จัดส่ง แต่ SHIPPING_ADDRESS_RE จับคำว่า "ที่อยู่/จังหวัด/ตำบล"
// เหมือนกันและรันก่อน จึงเคยถูกเด้งแอดมินทั้งหมด. เงื่อนไขตั้งให้แคบที่สุด 4 ชั้น
// เพื่อไม่ให้กลืนกฎ "เรื่องจัดส่งทุกกรณีต้องส่งแอดมิน":
//   1) ต้องพูดถึง "ร้าน" (ที่อยู่ของร้าน ไม่ใช่ของลูกค้า)
//   2) ต้องมีคำเชิงที่อยู่/เขตพื้นที่
//   3) ต้องมีคำถาม/คำขอ — กันลูกค้าพิมพ์ที่อยู่จัดส่งของตัวเองที่บังเอิญมีคำว่า "ร้าน"
//   4) ต้องไม่มีบริบทการส่งของหรือเอกสารภาษี
const SHOP_ADDRESS_LOCALITY_RE = /(ที่อยู่|ตำบล|อำเภอ|จังหวัด|รหัสไปรษณีย์|address)/i;
const SHOP_ADDRESS_ASK_RE = /(ไหน|อะไร|ยังไง|อย่างไร|ขอ|บอก|\?)/;
const DELIVERY_OR_TAX_CONTEXT_RE =
  /(จัดส่ง|ส่งของ|ส่งมา|ส่งไป|ส่งให้|ค่าส่ง|ปลายทาง|พัสดุ|ขนส่ง|เก็บเงินปลายทาง|\bcod\b|ใบกำกับ|ใบเสร็จ|ออกบิล|วางบิล|ภาษี|นิติบุคคล)/i;
function isShopLocationQuestion(text: string): boolean {
  return (
    /ร้าน/.test(text) &&
    SHOP_ADDRESS_LOCALITY_RE.test(text) &&
    SHOP_ADDRESS_ASK_RE.test(text) &&
    !DELIVERY_OR_TAX_CONTEXT_RE.test(text)
  );
}
const ORDER_STATUS_RE = /(สถานะ|เลขพัสดุ|ติดตาม|tracking|ของถึง|ส่งหรือยัง|ออเดอร์|order)/i;
const PRICE_NEGOTIATION_RE = /(ลดได้ไหม|ลดหน่อย|ต่อราคา|แพง|ราคาสุด|ขอราคา|ส่วนลด|discount)/i;
// A quotation is an operational sales request, not a request to discover another
// product. Keep this deterministic because the customer expects a human-produced
// document/commitment even when the LLM classifier is unavailable or uncertain.
// English "quote" is deliberately gated by a request/document cue so a product
// name containing that common word does not become an admin hand-off by itself.
const QUOTATION_REQUEST_RE =
  /(?:ใบ\s*เสนอ\s*ราคา|ใบ\s*(?:quotation|quote)\b|(?:ขอ|ทำ|ออก|จัดทำ|รบกวน\s*(?:ทำ|ออก|จัดทำ))\s*(?:ใบ\s*)?(?:quotation|quote)\b)/i;
const CLAIM_RE = /(เคลม|คืนของ|คืนสินค้า|เสีย|พัง|ชำรุด|เปลี่ยนสินค้า|รับประกัน|claim|return)/i;
const PURCHASE_INTENT_RE =
  /(เอาตัวนี้|เอาอันนี้|เอาเลย|จะเอา|เอากี่|เอา\s*\d|สั่งซื้อ|สั่งเลย|สั่งของ|ขอสั่ง|ซื้อเลย|ขอซื้อ|จะซื้อ|กี่บาท|ราคาเท่าไ|รวมส่ง|ค่าส่งเท่าไ|เก็บปลายทาง|เก็บเงินปลายทาง|โอนเข้าไหน|โอนยังไง|เลขบัญชี|เลขที่บัญชี|รับของยังไง|order now|check ?out)/i;
// ── ข้อมูลร้าน (SHOP_INFO) ────────────────────────────────────────────────────
// คำถามกลุ่มนี้ตอบเองได้ทั้งหมดจากค่าใน SiteConfig (เวลาทำการ/เบอร์/ที่อยู่/แผนที่)
// จึงต้องจับให้กว้างพอ ไม่งั้นข้อความจะไหลไป general_faq แล้วให้ Knowledge RAG
// แต่งคำตอบจากบทความ ซึ่งอาจให้เวลาทำการหรือช่องทางติดต่อที่ไม่ตรงกับค่าจริงในระบบ
// แยกเป็น 3 กลุ่มเพื่อให้อ่าน/ต่อเติมได้ง่าย แทนที่จะเป็น regex ยาวก้อนเดียว
const SHOP_HOURS_RE =
  /(เวลาทำการ|เวลาเปิด|เวลาปิด|กี่โมง|เปิดทุกวัน|ร้านเปิด|(?:เปิด|ปิด|หยุด)(?:หรือ|รึ|หรอ)?(?:เปล่า|ยัง|ไหม|มั้ย)|(?:เปิด|ปิด|หยุด)(?:วัน)?(?:ไหน|อะไร|เสาร์|อาทิตย์|จันทร์|ธรรมดา|นักขัตฤกษ์)|วันหยุด|opening\s*hours?|business\s*hours?)/i;
const SHOP_LOCATION_RE =
  /(ร้านอยู่ไหน|ร้านอยู่ที่ไหน|อยู่ที่ไหน|อยู่ตรงไหน|อยู่แถวไหน|อยู่ไหน|แถวไหน|ที่ตั้งร้าน|ที่ตั้ง|พิกัด|ปักหมุด|แผนที่|ไปร้าน|ไปยังไง|ไปไง|มีหน้าร้าน|มีสาขา|สาขา|location|map)/i;
const SHOP_CONTACT_RE =
  /(ติดต่อร้าน|ติดต่อสอบถาม|ช่องทางติดต่อ|ติดต่อ(?:ยัง)?(?:ไง|งัย|ไร)|ติดต่ออย่างไร|ติดต่อทางไหน|ติดต่อ(?:ได้)?(?:ที่)?ไหน|ขอสอบถามข้อมูล|ขอเบอร์|มีเบอร์|เบอร์โทร|เบอร์ร้าน|เบอร์ไหน|ขอแผนที่|ไลน์ไอดี|ไอดีไลน์|line\s*id|contact\s*us)/i;
const SHOP_INFO_RE = new RegExp(
  `(${SHOP_HOURS_RE.source}|${SHOP_LOCATION_RE.source}|${SHOP_CONTACT_RE.source})`,
  "i",
);
function routeText(text: string): ChatIntentRouteResult {
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

  // "ถามว่ามีบริการส่งไหม / ค่าส่งคิดยังไง" → ตอบเองด้วยข้อมูลร้าน ไม่เด้งแอดมิน.
  // ต้องเช็กก่อน SHIPPING_ADDRESS_RE ที่จับคำว่า "จัดส่ง/ส่งของ" เหมือนกัน.
  if (isServiceInquiryText(normalized)) {
    return {
      intent: LineIntent.UNKNOWN,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "SERVICE_INQUIRY_KEYWORD",
    };
  }

  // Warranty/returns and every shipping-related question are business operations
  // owned by an admin. Keep this deterministic and ahead of FAQ/shop-info routing
  // so neither the intent LLM nor Knowledge RAG can auto-answer these topics.
  const adminOnlyKnowledgeMatch = detectAdminOnlyKnowledgeMatch(normalized);
  if (adminOnlyKnowledgeMatch) {
    const adminOnlyKnowledgeTopic = adminOnlyKnowledgeMatch.topic;
    return {
      intent:
        adminOnlyKnowledgeTopic === "warranty_return"
          ? LineIntent.CLAIM_OR_RETURN
          : LineIntent.SHIPPING_ADDRESS,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason:
        adminOnlyKnowledgeTopic === "warranty_return"
          ? "WARRANTY_RETURN_ADMIN_ONLY"
          : "SHIPPING_ADMIN_ONLY",
      ...(adminOnlyKnowledgeMatch.matchedVia === "typo"
        ? {
            matchedVia: "typo" as const,
            matchedTypoKeyword: adminOnlyKnowledgeMatch.keyword ?? undefined,
          }
        : {}),
    };
  }

  if (SHIPPING_SERVICE_INQUIRY_RE.test(normalized)) {
    return {
      intent: LineIntent.SHIPPING_ADDRESS,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "SHIPPING_ADMIN_ONLY",
    };
  }

  // ถามที่ตั้งร้าน (ไม่ใช่ที่อยู่จัดส่ง) → ตอบเองด้วยข้อมูลร้าน ไม่เด้งแอดมิน
  if (isShopLocationQuestion(normalized)) {
    return {
      intent: LineIntent.SHOP_INFO,
      allowsSearch: false,
      requiresAdmin: false,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "SHOP_INFO_KEYWORD",
    };
  }

  if (SHIPPING_ADDRESS_RE.test(normalized) || looksLikeThaiPostalAddress(normalized)) {
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

  if (QUOTATION_REQUEST_RE.test(normalized)) {
    return {
      intent: LineIntent.PURCHASE_INTENT,
      allowsSearch: false,
      requiresAdmin: true,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: "QUOTATION_REQUEST_KEYWORD",
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

  // Typo backstop — LAST rule before the product default, so it can only ever
  // reclassify a message that would otherwise have been assumed to be a product
  // question. Catches an INTERNAL misspelling of a high-stakes operational keyword
  // ("เครม" for เคลม, "สลิบ" for สลิป) that the literal rules above cannot see.
  // Reuses the literal rule's own `reason`, so routing downstream is identical.
  const typoMatch = detectChatIntentTypo(normalized);
  if (typoMatch) {
    return {
      intent: typoMatch.intent,
      allowsSearch: false,
      requiresAdmin: typoMatch.intent !== LineIntent.SHOP_INFO,
      requiresImageAnalysis: false,
      requiresMoreInfo: false,
      reason: typoMatch.reason,
      matchedVia: "typo",
      matchedTypoKeyword: typoMatch.keyword,
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

export function routeChatIntent(input: ChatIntentRouteInput): ChatIntentRouteResult {
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
