import { LineAiConfidence, LineIntent } from "@/lib/generated/prisma";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import type { LineProductSearchBridgeResult } from "@/lib/line-product-search-bridge";
import { isLineMessageGroup, type LineMessageGroup } from "@/lib/line-intent-groups";

export type LineAiSuggestionDraft = {
  suggestedReply: string;
  confidence: LineAiConfidence;
  reasoningSummary: string;
  matchedProducts?: unknown;
};

/** One prior turn in the conversation, used to give the reply short-term memory. */
export type LineReplyHistoryItem = {
  role: "customer" | "shop";
  text: string;
};

/** A matched catalog product to present to the customer (names are never fabricated). */
export type LineProductSummary = {
  name: string;
  code: string | null;
};

// Interactive chat calls fail over fast (don't burn the full 30s on a hung key)
// and try only a few keys, so one turn can't stack timeouts past the reply-token
// window. Background jobs (embeddings/backfill) keep the client defaults.
export const CHAT_CALL_TIMEOUT_MS = 15_000;
export const CHAT_MAX_KEY_ATTEMPTS = 3;

const GEMINI_REPLYABLE_INTENTS = new Set<LineIntent>([
  LineIntent.PRODUCT_INQUIRY_TEXT,
  LineIntent.PART_IMAGE_INQUIRY,
  LineIntent.GREETING,
]);

const LINE_AI_SYSTEM_INSTRUCTION = [
  'คุณคือ "คุณจูน" แอดมินร้าน "ศรีวรรณอะไหล่แอร์" ผู้หญิงอายุ 29 ปี',
  "",
  "บุคลิก:",
  "- เป็นกันเอง คุยเหมือนคนจริง ไม่เป็นทางการจนเกินไป",
  "- สุภาพ อัธยาศัยดี ยิ้มแย้ม พร้อมช่วยเหลือลูกค้า",
  "- ละเอียดรอบคอบ ไม่รีบสรุปข้อมูลถ้ายังไม่มั่นใจ",
  "- ให้ความสำคัญกับการหาอะไหล่ให้ตรงรุ่น เพื่อลดความผิดพลาดในการสั่งซื้อ",
  "- สามารถใช้อิโมจิได้ตามความเหมาะสม 😊🙏🚗🔧 แต่ไม่มากจนดูไม่เป็นมืออาชีพ",
  "",
  "หน้าที่:",
  "- ตอบแชทลูกค้าเกี่ยวกับอะไหล่แอร์รถยนต์ หม้อน้ำ คอมแอร์ คอยล์เย็น แผงแอร์ มอเตอร์พัดลม วาล์วแอร์ กรองแอร์ และอะไหล่ที่เกี่ยวข้อง",
  "- ช่วยสอบถามข้อมูลที่จำเป็นเพื่อหาอะไหล่ให้ตรงรุ่นมากที่สุด",
  "- ทำให้ลูกค้ารู้สึกว่ากำลังคุยกับพนักงานร้านจริง ไม่ใช่ระบบอัตโนมัติ",
  "",
  "กฎความปลอดภัยที่ห้ามฝ่าฝืน:",
  "- ห้ามยืนยันว่าอะไหล่ใช้กับรถรุ่นนั้นได้แน่นอน หากยังไม่มีข้อมูลยืนยันเพียงพอ",
  '- ให้ใช้คำว่า "เบื้องต้น" "จากข้อมูลที่แจ้งมา" หรือ "แนะนำให้เทียบก่อนนะคะ"',
  "- ห้ามแต่งข้อมูล ราคา สต๊อก เลขอะไหล่ OEM หรือข้อมูลทางเทคนิคที่ไม่ได้รับมา",
  "- หากข้อมูลไม่พอ ต้องขอข้อมูลเพิ่มเติม เช่น รุ่นรถ ปีรถ เครื่องยนต์ เบอร์อะไหล่เดิม หรือรูปอะไหล่เดิม",
  "- ห้ามรับปากเรื่องส่วนลด การเคลม การรับประกัน หรือเงื่อนไขพิเศษใด ๆ ให้แจ้งว่าจะส่งต่อให้แอดมินตรวจสอบเพิ่มเติม",
  "- หากไม่มั่นใจในข้อมูล ให้แจ้งลูกค้าตรงไปตรงมาว่าขอตรวจสอบเพิ่มเติมก่อน",
  "",
  "รูปแบบการตอบ:",
  "- ตอบสั้น กระชับ อ่านง่าย ไม่เกิน 4 บรรทัด",
  "- ใช้ภาษาพูดสุภาพแบบพนักงานร้านจริง",
  '- ลงท้ายด้วย "ค่ะ" เป็นหลัก',
  "- สามารถใช้อิโมจิได้ 0-2 ตัวต่อข้อความ",
  '- หลีกเลี่ยงการใช้ภาษาหุ่นยนต์ เช่น "โปรดระบุข้อมูลเพิ่มเติม" หรือ "กรุณาทำการส่งข้อมูล"',
  "",
  "ตัวอย่างการตอบ:",
  "",
  "ลูกค้า: มีคอยล์เย็นวีออสไหม",
  "ตอบ:",
  "มีหลายรุ่นเลยค่ะ 😊",
  "รบกวนขอปีรถ หรือส่งรูปอะไหล่เดิมมาดูเพิ่มเติมได้ไหมคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ",
  "",
  "ลูกค้า: ใช้กับ Civic FC ได้ไหม",
  "ตอบ:",
  "จากข้อมูลที่แจ้งมา เบื้องต้นยังสรุปไม่ได้ค่ะ 🙏",
  "รบกวนขอปีรถ รุ่นย่อย หรือรูปอะไหล่เดิมเพิ่มเติมนะคะ จะได้เช็กให้ตรงรุ่นค่ะ",
  "",
  "ลูกค้า: ลดราคาได้ไหม",
  "ตอบ:",
  "เรื่องราคาเดี๋ยวจูนส่งต่อให้แอดมินตรวจสอบให้นะคะ 😊",
  "",
  "ลูกค้า: มีของพร้อมส่งไหม",
  "ตอบ:",
  "รบกวนขอรหัสสินค้าหรือรูปสินค้าก่อนนะคะ 😊",
  "เดี๋ยวจูนเช็กข้อมูลให้ค่ะ",
  "",
  "เป้าหมาย:",
  "ทำให้ลูกค้ารู้สึกสบายใจ เหมือนคุยกับพนักงานร้านจริงที่ใส่ใจรายละเอียด พร้อมช่วยหาอะไหล่ให้ตรงรุ่นที่สุด โดยไม่เดาหรือให้ข้อมูลที่ไม่แน่ชัด",
].join("\n");

/**
 * Generates a conservative LINE reply using the Gemini multi-key client.
 * Falls back to the deterministic rule-based suggestion whenever Gemini is not
 * configured, the intent is not safe for AI, or any generation error occurs.
 */
export async function generateLineSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
  /** Recent prior turns (oldest → newest), excluding the current message. */
  history?: LineReplyHistoryItem[];
  /** Matched catalog products to present to the customer (real names from the DB). */
  products?: LineProductSummary[];
}): Promise<LineAiSuggestionDraft> {
  const fallback = buildConservativeLineSuggestion(input);

  // Skip the model when keys are absent, the intent isn't AI-replyable, or the
  // deterministic policy already decided this must go to an admin (e.g. a part
  // image with image-search disabled) — saves a wasted Gemini call.
  if (
    !hasGeminiKeysConfigured() ||
    !GEMINI_REPLYABLE_INTENTS.has(input.intent) ||
    fallback.confidence === LineAiConfidence.ADMIN_REQUIRED
  ) {
    return fallback;
  }

  try {
    const prompt = buildLineReplyPrompt(input);
    const { suggestedReply } = await generateGeminiContent({
      prompt,
      systemInstruction: LINE_AI_SYSTEM_INSTRUCTION,
      maxOutputTokens: 600,
      temperature: 0.4,
      // Conservative shop replies don't need deep reasoning; HIGH thinking would
      // consume the output budget and truncate the message mid-sentence.
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    }).then((result) => ({ suggestedReply: result.text.trim() }));

    if (!suggestedReply) {
      return fallback;
    }

    return {
      suggestedReply,
      // Confidence is derived from the deterministic policy, not from the model,
      // so the send-decision layer keeps the same safety guarantees.
      confidence: fallback.confidence,
      reasoningSummary: `Gemini reply (intent=${input.intent}); confidence from rule-based policy.`,
      matchedProducts: fallback.matchedProducts,
    };
  } catch {
    return fallback;
  }
}

const SEARCH_INTENT_SYSTEM_INSTRUCTION = [
  "คุณคือตัวจัดกลุ่มข้อความลูกค้าในแชทร้านอะไหล่แอร์รถยนต์ (ศรีวรรณอะไหล่แอร์)",
  "อ่านบทสนทนาทั้งหมด โฟกัสที่ 'ข้อความล่าสุด' แล้วตอบเป็น JSON object บรรทัดเดียวเท่านั้น (ไม่มีคำอธิบาย ไม่มี markdown):",
  "",
  "{",
  '  "group": "<ชื่อกลุ่ม>",',
  '  "query": "คำค้นสั้น ๆ รวมทุกอย่างที่ลูกค้าบอก (ชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ + ปี) — เฉพาะเมื่อ group=product",',
  '  "partType": "ชนิดอะไหล่ เช่น หม้อน้ำ คอยล์เย็น คอมแอร์ แผงแอร์ กรองแอร์ (ถ้าไม่ทราบใส่ null)",',
  '  "carBrand": "ยี่ห้อรถ เช่น Mazda Toyota Isuzu (ถ้าไม่ทราบใส่ null)",',
  '  "carModel": "รุ่นรถ เช่น Mazda 2, D-Max, Vios (ถ้าไม่ทราบใส่ null)",',
  '  "year": ปีรถเป็นเลข ค.ศ. 4 หลัก หรือ null',
  "}",
  "",
  "กลุ่ม (เลือก 1):",
  "- product = ถามหา/ค้นหาอะไหล่ หรือให้รายละเอียดเพิ่ม (ปี/รุ่น) ต่อจากที่ถามหาสินค้า",
  "- shop_info = ที่ตั้งร้าน/เวลาเปิด-ปิด/เบอร์โทร/แผนที่/มีหน้าร้านไหม/ไปร้านยังไง",
  "- general_faq = วิธีสั่งซื้อ/วิธีค้นหา/ส่งต่างจังหวัดไหม/นโยบายร้าน (คำถามทั่วไปที่ไม่ใช่ตัวสินค้า)",
  "- payment = แจ้งโอน/ส่งสลิป/ถามวิธีชำระเงิน",
  "- shipping_address = แจ้งที่อยู่/ขอให้จัดส่ง",
  "- order_status = ติดตามพัสดุ/สถานะออเดอร์",
  "- price_negotiation = ต่อราคา/ขอส่วนลด",
  "- claim_or_return = เคลม/คืน/เปลี่ยนสินค้า/ของเสีย-ชำรุด",
  "- purchase = ตกลงซื้อ/สั่งเลย/ถามเลขบัญชี-วิธีโอนเพื่อจะจ่าย",
  "- greeting = ทักทายอย่างเดียว (สวัสดี/หวัดดี)",
  "- social = ขอบคุณ/ตอบรับ (ครับ/ค่ะ/โอเค/รับทราบ)/คุยเล่นสั้น ๆ",
  "- other = ไม่แน่ใจ/จัดกลุ่มไม่ได้",
  "",
  "กฎ:",
  "- ถ้าไม่มั่นใจว่าเข้ากลุ่มไหน ให้ตอบ group=other (อย่าเดาเป็น product)",
  "- query ใส่เฉพาะเมื่อ group=product เท่านั้น (กลุ่มอื่นใส่ null) — และรวมข้อมูลที่ทยอยพิมพ์หลายข้อความเข้าด้วยกัน",
  "- แปลงปีย่อ 2 หลักเป็น ค.ศ. 4 หลัก เช่น '06' → 2006; ปี พ.ศ. เช่น 2560 → 2017",
  "- ห้ามแต่งข้อมูลที่ลูกค้าไม่ได้พูด ฟิลด์ใดไม่ทราบให้ใส่ null",
].join("\n");

const MAX_CONSOLIDATED_QUERY_LENGTH = 120;
const MIN_SEARCH_YEAR = 1950;
const MAX_SEARCH_YEAR = 2100;

/** Classified intent + structured search hints distilled from the conversation.
 *  `group` drives routing (product / shop_info / payment / ... / other). `query`
 *  and the fitment hints are only meaningful for `group === "product"`.
 *  `isProductQuery` is kept as a convenience mirror of `group === "product"`. */
export type LineSearchIntent = {
  group: LineMessageGroup;
  query: string;
  isProductQuery: boolean;
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
};

const cleanIntentString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\r\n]+/g, " ").trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toUpperCase() === "NONE") return null;
  return trimmed;
};

const cleanIntentYear = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isInteger(num) || num < MIN_SEARCH_YEAR || num > MAX_SEARCH_YEAR) return null;
  return num;
};

/**
 * Parses the model's JSON reply into a LineSearchIntent. Pure + defensive: strips
 * markdown fences, tolerates extra prose around the object, and returns null when
 * there's no usable `query`. Exported for unit testing.
 */
export const parseLineSearchIntent = (raw: string): LineSearchIntent | null => {
  if (!raw) return null;
  // Grab the first {...} block so stray prose / code fences don't break parsing.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;

  // Resolve the group. Back-compat: an older reply with only `isProductQuery`
  // maps to product/other; an unknown/missing group is treated as `other` (the
  // safe "try FAQ then ask" path) rather than guessed as a product search.
  const groupRaw = typeof obj.group === "string" ? obj.group.trim().toLowerCase() : "";
  const group: LineMessageGroup = isLineMessageGroup(groupRaw)
    ? groupRaw
    : obj.isProductQuery === true
      ? "product"
      : obj.isProductQuery === false
        ? "other"
        : "other";

  const query = cleanIntentString(obj.query);
  const isProductQuery = group === "product";

  return {
    group,
    query: query ? query.slice(0, MAX_CONSOLIDATED_QUERY_LENGTH).trim() : "",
    isProductQuery,
    partType: cleanIntentString(obj.partType),
    carBrand: cleanIntentString(obj.carBrand),
    carModel: cleanIntentString(obj.carModel),
    year: cleanIntentYear(obj.year),
  };
};

/**
 * Classifies the latest message into a {@link LineMessageGroup} AND, for product
 * turns, distils the consolidated search query + fitment hints from the whole
 * conversation (so drip-fed details "คอยเย็น d max" → "ปี 06" search the COMBINED
 * subject). Runs on EVERY text turn (first turn included) so routing is robust to
 * phrasing — the caller (processor) decides when to skip it (e.g. a keyword guard
 * hit). The `intent` arg is unused now but kept for the dependency signature.
 *
 * Returns null only when Gemini is unavailable or the reply can't be parsed — the
 * caller then falls back to the deterministic Layer-1 (regex) routing.
 */
export async function extractLineSearchIntent(input: {
  intent: LineIntent;
  latestText?: string | null;
  history?: LineReplyHistoryItem[];
}): Promise<LineSearchIntent | null> {
  if (!hasGeminiKeysConfigured()) {
    return null;
  }

  try {
    const history = input.history ?? [];
    const lines: string[] = [
      "บทสนทนา (เก่าสุด → ใหม่สุด):",
      ...history.map((turn) => `${turn.role === "customer" ? "ลูกค้า" : "ร้าน"}: ${turn.text}`),
      `ลูกค้า (ข้อความล่าสุด): ${input.latestText?.trim() || "(ไม่มีข้อความ อาจเป็นรูปภาพ)"}`,
      "",
      "ตอบเป็น JSON object บรรทัดเดียวตามรูปแบบที่กำหนด:",
    ];

    const { text } = await generateGeminiContent({
      prompt: lines.join("\n"),
      systemInstruction: SEARCH_INTENT_SYSTEM_INSTRUCTION,
      maxOutputTokens: 160,
      temperature: 0,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });

    return parseLineSearchIntent(text);
  } catch {
    return null;
  }
}

function buildLineReplyPrompt(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
  history?: LineReplyHistoryItem[];
  products?: LineProductSummary[];
}): string {
  const lines: string[] = [];

  if (input.history && input.history.length > 0) {
    lines.push("ประวัติการสนทนาก่อนหน้า (เก่าสุด → ใหม่สุด) ใช้เป็นบริบท อย่าถามข้อมูลที่ลูกค้าให้ไปแล้วซ้ำ:");
    for (const turn of input.history) {
      lines.push(`${turn.role === "customer" ? "ลูกค้า" : "ร้าน"}: ${turn.text}`);
    }
    lines.push("");
  }

  lines.push(`ข้อความล่าสุดจากลูกค้า: ${input.originalText?.trim() || "(ไม่มีข้อความ อาจเป็นรูปภาพ)"}`);

  if (input.products && input.products.length > 0) {
    lines.push("รายการสินค้าที่พบในระบบ (เบื้องต้น ใกล้เคียงกับที่ลูกค้าถาม):");
    for (const product of input.products) {
      lines.push(`- ${product.name}${product.code ? ` (รหัส ${product.code})` : ""}`);
    }
    lines.push(
      "ให้นำเสนอรายการเหล่านี้กับลูกค้าได้เลยเพื่อช่วยตัดสินใจเบื้องต้น โดยใช้ชื่อสินค้าตามนี้ ห้ามแต่งชื่อ/รหัสเพิ่มเอง",
    );
    lines.push(
      "สำคัญ: เรียงรายการในคำตอบ 'ตามลำดับที่ให้มาเป๊ะ' ห้ามสลับ/จัดลำดับใหม่ เพราะต้องตรงกับการ์ดสินค้าที่ส่งคู่กัน",
    );
    lines.push(
      [
        "รูปแบบการแสดงรายการสินค้า (ต้องทำตามนี้เป๊ะ เพื่อให้แต่ละรายการแยกชัดอ่านง่าย):",
        "- ขึ้นรายการแรกด้วยการเว้นบรรทัดว่าง 1 บรรทัดจากข้อความเปิด",
        "- แต่ละสินค้าขึ้นต้นด้วยเลขลำดับอิโมจิ 1️⃣ 2️⃣ 3️⃣ ... ตามด้วยชื่อสินค้าเต็ม",
        "- บรรทัดถัดมาของสินค้านั้นใส่รหัสในรูปแบบ '🏷️ รหัส <รหัส>' (ถ้าสินค้าไม่มีรหัสให้ข้ามบรรทัดนี้)",
        "- คั่นระหว่างสินค้าแต่ละรายการด้วยเส้น '━━━━━━━━━━━━━━' บรรทัดเดียว",
        "- หลังรายการสุดท้ายเว้นบรรทัดว่าง 1 บรรทัดก่อนข้อความปิดท้าย",
        "ตัวอย่างรูปแบบ:",
        "1️⃣ ชื่อสินค้า A",
        "🏷️ รหัส P0001",
        "━━━━━━━━━━━━━━",
        "2️⃣ ชื่อสินค้า B",
        "🏷️ รหัส P0002",
      ].join("\n"),
    );
    lines.push(
      "ย้ำกับลูกค้าว่าเป็นการเทียบเบื้องต้นจากข้อมูลที่ได้ และแนะนำให้ตรวจสอบ/ยืนยันความเข้ากันกับทางร้านอีกครั้งก่อนสั่งซื้อ ไม่ต้องบังคับให้ลูกค้าระบุเลขตัวถังหรือรหัส OEM",
    );
  } else if (input.productSearch?.searched) {
    if (input.productSearch.needsMoreInfo) {
      lines.push(
        "ผลการค้นหาสินค้า: ยังไม่พบรายการที่ตรงในระบบ ให้สอบถามรายละเอียดเพิ่มอย่างเป็นกันเอง เช่น รุ่นรถ ปีรถ หรือรูปอะไหล่เดิม (ไม่จำเป็นต้องมีเลขตัวถังหรือรหัส OEM) ห้ามเดาสินค้า",
      );
    } else {
      lines.push(
        `ผลการค้นหาสินค้า: พบรายการใกล้เคียง ${input.productSearch.result.total} รายการ ให้เสนอเบื้องต้นและแนะนำให้ตรวจสอบกับทางร้านก่อนสั่งซื้อ`,
      );
    }
  } else {
    lines.push("ผลการค้นหาสินค้า: ไม่ได้ค้นหา ให้ทักทายและถามรายละเอียดอะไหล่ที่ต้องการอย่างเป็นกันเอง");
  }

  lines.push("กรุณาร่างข้อความตอบลูกค้า 1 ข้อความ ตามกฎความปลอดภัยทั้งหมด");
  return lines.join("\n");
}

/** Divider between product items in customer-facing list messages (style A). */
const PRODUCT_LIST_DIVIDER = "━━━━━━━━━━━━━━";
const PRODUCT_LIST_NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

/**
 * Formats matched products as a clear, separated list block (style A): each item
 * is numbered, the product code is on its own highlighted line, and items are
 * split by a divider so they read as distinct entries. Shared by every
 * customer-facing list reply so the deterministic templates and the live AI path
 * stay visually identical. Returns "" when there are no products.
 */
export function formatProductListBlock(products: LineProductSummary[]): string {
  return products
    .slice(0, 5)
    .map((product, index) => {
      const number = PRODUCT_LIST_NUMBER_EMOJI[index] ?? `${index + 1}.`;
      const codeLine = product.code ? `\n🏷️ รหัส ${product.code}` : "";
      return `${number} ${product.name}${codeLine}`;
    })
    .join(`\n${PRODUCT_LIST_DIVIDER}\n`);
}

export function buildConservativeLineSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
  products?: LineProductSummary[];
}): LineAiSuggestionDraft {
  if (input.intent === LineIntent.GREETING) {
    return {
      suggestedReply: "สวัสดีค่ะ 😊 จูนช่วยหาอะไหล่แอร์ให้ได้เลยค่ะ รบกวนแจ้งรุ่นรถ ปีรถ หรือส่งรูปอะไหล่เดิมมาได้เลยนะคะ",
      confidence: LineAiConfidence.NEED_MORE_INFO,
      reasoningSummary: "Greeting only; ask for vehicle or part details before search.",
    };
  }

  const isSearchBackedInquiry =
    input.intent === LineIntent.PRODUCT_INQUIRY_TEXT || input.intent === LineIntent.PART_IMAGE_INQUIRY;

  if (isSearchBackedInquiry && input.productSearch?.searched) {
    if (input.productSearch.needsMoreInfo) {
      return {
        suggestedReply:
          "ตอนนี้ยังไม่พบข้อมูลที่ยืนยันได้ชัดเจนค่ะ รบกวนส่งรุ่นรถ ปีรถ เครื่องยนต์ หรือรูปอะไหล่เดิม/เบอร์บนตัวอะไหล่เพิ่มเติมนะคะ จะได้ช่วยเทียบให้แม่นยำขึ้นค่ะ",
        confidence: LineAiConfidence.NEED_MORE_INFO,
        reasoningSummary: "Product search returned weak/no results.",
        matchedProducts: input.productSearch.result,
      };
    }

    const productLines = formatProductListBlock(input.products ?? []);

    return {
      suggestedReply: productLines
        ? `เบื้องต้นพบรายการที่ใกล้เคียงในร้านค่ะ 😊\n\n${productLines}\n\nเป็นการเทียบเบื้องต้นนะคะ แนะนำให้ตรวจสอบกับทางร้านอีกครั้งก่อนสั่งซื้อค่ะ`
        : "เบื้องต้นพบรายการที่ใกล้เคียงในร้านค่ะ 😊 เป็นการเทียบเบื้องต้น แนะนำให้ตรวจสอบกับทางร้านอีกครั้งก่อนสั่งซื้อนะคะ",
      confidence: LineAiConfidence.POSSIBLE_MATCH,
      reasoningSummary: "Product search returned candidate products; reply remains conservative.",
      matchedProducts: input.productSearch.result,
    };
  }

  return {
    suggestedReply: "ขอส่งต่อให้แอดมินช่วยตรวจสอบเพิ่มเติมให้นะคะ 🙏",
    confidence: LineAiConfidence.ADMIN_REQUIRED,
    reasoningSummary: `Intent ${input.intent} is not safe for automatic detailed reply.`,
  };
}

/**
 * Deterministic reply used when the Gemini reply doesn't return before the
 * reply-token deadline (so we still answer within the FREE reply window instead
 * of paying for a push). Written in จูน's voice and references the customer's
 * subject + the SAME matched products/cards — only the prose is templated; the
 * product results shown are identical to the live path.
 */
export function buildJuneDeadlineReply(input: {
  query?: string | null;
  products?: LineProductSummary[];
}): string {
  const subject = input.query?.trim();
  const products = input.products ?? [];

  if (products.length === 0) {
    return subject
      ? `สำหรับ "${subject}" ตอนนี้จูนขอเวลาตรวจสอบเพิ่มอีกนิดนะคะ 🙏 รบกวนแจ้งรุ่นรถ ปีรถ หรือส่งรูปอะไหล่เดิม/เบอร์บนตัวอะไหล่เพิ่มเติม จะได้ช่วยเทียบให้แม่นยำขึ้นค่ะ`
      : "รบกวนแจ้งรุ่นรถ ปีรถ หรือส่งรูปอะไหล่เดิมเพิ่มเติมนะคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ 🙏";
  }

  const productLines = formatProductListBlock(products);

  const opener = subject
    ? `สำหรับ "${subject}" เบื้องต้นจูนเจอรายการที่ใกล้เคียงในร้านดังนี้ค่ะ 😊`
    : "เบื้องต้นจูนเจอรายการที่ใกล้เคียงในร้านดังนี้ค่ะ 😊";

  return `${opener}\n\n${productLines}\n\nเป็นการเทียบเบื้องต้นนะคะ รบกวนเช็กกับทางร้านอีกครั้งก่อนสั่งซื้อนะคะ 🙏`;
}

/**
 * Deterministic จูน-voiced "ask for details" reply, used for the `other` group
 * when the FAQ can't answer, and as the classify-failure fallback. Keeps the
 * conversation moving (never a robotic dead-end / silent handoff) and works even
 * when the LLM itself is unavailable.
 */
export function buildJuneAskDetailsReply(): string {
  return "ขอโทษนะคะ 🙏 รบกวนแจ้งรุ่นรถ ปีรถ และอะไหล่ที่ต้องการ หรือส่งรูปอะไหล่เดิม/เบอร์บนตัวอะไหล่มาได้เลยค่ะ เดี๋ยวจูนช่วยเช็กให้นะคะ 😊";
}

/** Short, warm acknowledgement for the `social` group (thanks / ok / chit-chat). */
export function buildJuneSocialReply(): string {
  return "ยินดีค่ะ 🙏 มีอะไรให้จูนช่วยเพิ่มเติม แจ้งได้เลยนะคะ 😊";
}
