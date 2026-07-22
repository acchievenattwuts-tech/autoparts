import { LineAiConfidence, LineIntent } from "@/lib/generated/prisma";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import type { ChatProductSearchBridgeResult } from "@/lib/chat-core/product-search-bridge";
import { isChatMessageGroup, type ChatMessageGroup } from "@/lib/chat-core/intent-groups";
import { toGregorianCarYear } from "@/lib/car-year-shorthand";

export type ChatAiSuggestionDraft = {
  suggestedReply: string;
  confidence: LineAiConfidence;
  reasoningSummary: string;
  matchedProducts?: unknown;
};

/** One prior turn in the conversation, used to give the reply short-term memory. */
export type ChatReplyHistoryItem = {
  role: "customer" | "shop";
  text: string;
};

/** A matched catalog product to present to the customer (names are never fabricated). */
export type ChatProductSummary = {
  name: string;
  code: string | null;
  salePrice: number;
};

// Interactive chat calls fail over fast (don't burn the full 30s on a hung key)
// and try only a few keys, so one turn can't stack timeouts past the reply-token
// window. Background jobs (embeddings/backfill) keep the client defaults.
//
// Tightened 2026-06-23 (15s/3 → 8s/2): a product turn fires several SEQUENTIAL
// chat calls (extract-intent → purchase-intent → faq/suggest). During a Gemini
// latency spike each was returning at ~14s (just under the old 15s cap), so the
// turn stacked past the 60s serverless ceiling → reply token expired (slow PUSH)
// and the coalesce lease lapsed → job killed as STALE_PROCESSING_TIMEOUT (~126s).
// 8s still clears normal flash-lite latency (~1–4s); only a genuine spike now
// aborts → deterministic จูน-voiced fallback (same products/cards, templated
// wording) that still lands inside the free reply-token window. A spike hits all
// keys at once, so a 3rd key attempt only wasted time — 2 is enough for the
// 429/rotate case it's actually there for.
export const CHAT_CALL_TIMEOUT_MS = 8_000;
export const CHAT_MAX_KEY_ATTEMPTS = 2;
// Multi-subject product intents include a subjects[] array. 160 tokens truncated
// valid Gemini JSON mid-object, which made the caller treat a successful
// classification as unavailable and skip search entirely. This only expands the
// extraction response envelope; it does not change catalog query/ranking logic.
export const CHAT_SEARCH_INTENT_MAX_OUTPUT_TOKENS = 512;

const GEMINI_REPLYABLE_INTENTS = new Set<LineIntent>([
  LineIntent.PRODUCT_INQUIRY_TEXT,
  LineIntent.PART_IMAGE_INQUIRY,
  LineIntent.GREETING,
]);

const LINE_AI_SYSTEM_INSTRUCTION = [
  'คุณคือ "คุณจูน" แอดมินร้าน "ศรีวรรณอะไหล่แอร์" (จำหน่ายอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์) ผู้หญิงอายุ 29 ปี',
  "",
  "บุคลิก:",
  "- เป็นกันเอง คุยเหมือนคนจริง ไม่เป็นทางการจนเกินไป",
  "- สุภาพ อัธยาศัยดี ยิ้มแย้ม พร้อมช่วยเหลือลูกค้า",
  "- ละเอียดรอบคอบ ไม่รีบสรุปข้อมูลถ้ายังไม่มั่นใจ",
  "- ให้ความสำคัญกับการหาอะไหล่ให้ตรงรุ่น เพื่อลดความผิดพลาดในการสั่งซื้อ",
  "- สามารถใช้อิโมจิได้ตามความเหมาะสม 😊🙏🚗🔧 แต่ไม่มากจนดูไม่เป็นมืออาชีพ",
  "",
  "หน้าที่:",
  "- ตอบแชทลูกค้าเกี่ยวกับอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ เช่น คอมแอร์ คอยล์เย็น แผงแอร์ มอเตอร์พัดลม วาล์วแอร์ กรองแอร์ หม้อน้ำ ฝาหม้อน้ำ และอะไหล่ที่เกี่ยวข้อง",
  "- ช่วยสอบถามข้อมูลที่จำเป็นเพื่อหาอะไหล่ให้ตรงรุ่นมากที่สุด",
  "- ทำให้ลูกค้ารู้สึกว่ากำลังคุยกับพนักงานร้านจริง ไม่ใช่ระบบอัตโนมัติ",
  "",
  "กฎความปลอดภัยที่ห้ามฝ่าฝืน:",
  "- ห้ามยืนยันว่าอะไหล่ใช้กับรถรุ่นนั้นได้แน่นอน หากยังไม่มีข้อมูลยืนยันเพียงพอ",
  '- ห้ามฟันธงว่าอะไหล่ "ใช้ไม่ได้" หรือ "ใส่ไม่ได้" กับรถปี/รุ่นใด ๆ เช่นกัน — ระบบไม่มีข้อมูลยืนยันความเข้ากันต่อปีรถ ห้ามอนุมานจากปี/ชื่อรุ่นที่อยู่ในชื่อสินค้าเอง',
  '- ให้ใช้คำว่า "เบื้องต้น" "จากข้อมูลที่แจ้งมา" หรือ "แนะนำให้เทียบก่อนนะคะ"',
  "- ห้ามแต่งข้อมูล ราคา สต๊อก เลขอะไหล่ OEM หรือข้อมูลทางเทคนิคที่ไม่ได้รับมา",
  "- หากข้อมูลไม่พอ ต้องขอข้อมูลเพิ่มเติม เช่น รุ่นรถ ปีรถ เครื่องยนต์ เบอร์อะไหล่เดิม หรือรูปอะไหล่เดิม",
  "- ห้ามรับปากเรื่องส่วนลด การเคลม การรับประกัน หรือเงื่อนไขพิเศษใด ๆ ให้แจ้งว่าจะส่งต่อให้แอดมินตรวจสอบเพิ่มเติม",
  "- หากไม่มั่นใจในข้อมูล ให้แจ้งลูกค้าตรงไปตรงมาว่าขอตรวจสอบเพิ่มเติมก่อน",
  "- ลูกค้ากำลังแชทใน LINE นี้อยู่แล้ว ห้ามบอกให้ 'ทัก LINE OA' หรือ 'ติดต่อ/โทรหาร้าน' เพื่อทำสิ่งที่พิมพ์/ส่งรูปในแชตนี้ได้ — ให้ชวนแจ้งข้อมูลตรงนี้แทน (ยกเว้นลูกค้าขอเบอร์โทร/ที่อยู่ร้านเอง จึงให้ข้อมูลติดต่อได้)",
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
export async function generateChatSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: ChatProductSearchBridgeResult | null;
  /** Recent prior turns (oldest → newest), excluding the current message. */
  history?: ChatReplyHistoryItem[];
  /** Matched catalog products to present to the customer (real names from the DB). */
  products?: ChatProductSummary[];
}): Promise<ChatAiSuggestionDraft> {
  const fallback = buildConservativeChatSuggestion(input);

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
  "คุณคือตัวจัดกลุ่มข้อความลูกค้าในแชทร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ (ศรีวรรณอะไหล่แอร์)",
  "อ่านบทสนทนาทั้งหมด โฟกัสที่ 'ข้อความล่าสุด' แล้วตอบเป็น JSON object บรรทัดเดียวเท่านั้น (ไม่มีคำอธิบาย ไม่มี markdown):",
  "",
  "{",
  '  "group": "<ชื่อกลุ่ม>",',
  '  "query": "คำค้นสั้น ๆ รวมทุกอย่างที่ลูกค้าบอก (ชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ + ปี) — เฉพาะเมื่อ group=product",',
  '  "partType": "ชนิดอะไหล่ เช่น หม้อน้ำ คอยล์เย็น คอมแอร์ แผงแอร์ กรองแอร์ (ถ้าไม่ทราบใส่ null)",',
  '  "carBrand": "ยี่ห้อรถ เช่น Mazda Toyota Isuzu (ถ้าไม่ทราบใส่ null)",',
  '  "carModel": "รุ่นรถ เช่น Mazda 2, D-Max, Vios (ถ้าไม่ทราบใส่ null)",',
  '  "year": ปีรถเป็นเลข ค.ศ. 4 หลัก หรือ null,',
  '  "partKind": "fitment หรือ universal — fitment = อะไหล่ที่ต้องระบุรุ่นรถถึงจะหาตรงได้ (หม้อน้ำ คอยล์เย็น คอมแอร์ แผงร้อน ตู้แอร์ กรองแอร์ ฯลฯ); universal = สินค้าที่ค้นด้วยชื่อ/สเปกได้เองไม่ต้องผูกรุ่นรถ (น้ำยาล้างคอยล์ ฟองน้ำ น็อต โอริง หัวคอปเปอร์ เทปพันสายไฟ ฯลฯ) ถ้าไม่แน่ใจใส่ null",',
  '  "tooBroad": true/false — true เมื่อข้อความกว้าง/สั้นเกินจนค้นแล้วได้ผลกว้างมาก เช่น "น็อต" "สายไฟ" "อะไหล่" คำเดียวโดยไม่มีตัวขยาย',
  '  "subjects": [ {"partType":..,"carBrand":..,"carModel":..,"year":..,"partKind":..,"query":..}, ... ] — ใส่เฉพาะเมื่อลูกค้าถามหา "อะไหล่ตั้งแต่ 2 ชนิดที่ต่างกัน" ในคราวเดียว เช่น "คอมแอร์กับคอยเย็น D-Max" ให้แยกเป็น 2 รายการ; ถ้าถามชนิดเดียว (แม้ระบุหลายรุ่นรถ เช่น "คอยเย็น D-Max กับ Vigo") ให้ใส่ [] เท่านั้น',
  "}",
  "",
  "กลุ่ม (เลือก 1):",
  "- product = ถามหา/ค้นหาอะไหล่ หรือให้รายละเอียดเพิ่ม (ปี/รุ่น) ต่อจากที่ถามหาสินค้า รวมถึง 'ถามราคาของอะไหล่ที่ระบุชนิด/รุ่นรถได้' เช่น 'หม้อน้ำ d-max ราคาเท่าไหร่' = product (ลูกค้ายังหาของอยู่ ไม่ใช่ตกลงซื้อ)",
  "- stock_availability = ถามว่ามีของ/มีสินค้า/ของพร้อมส่งไหม โดย 'ข้อความล่าสุด' ไม่ได้ระบุชนิดอะไหล่ ยี่ห้อ/รุ่นรถ หรือปีรถเลย เช่น 'มีของไหม' 'ที่ร้านมีของใช้ไหม' 'ของพร้อมส่งไหม' — ถ้าข้อความระบุชนิดอะไหล่หรือรุ่นรถมาด้วย เช่น 'มีหม้อน้ำ D-Max ไหม' ให้เป็น product",
  "- shop_info = ที่ตั้งร้าน/เวลาเปิด-ปิด/เบอร์โทร/แผนที่/มีหน้าร้านไหม/ไปร้านยังไง",
  "- general_faq = วิธีสั่งซื้อ/วิธีค้นหา/ส่งต่างจังหวัดไหม/นโยบายร้าน (คำถามทั่วไปที่ไม่ใช่ตัวสินค้า)",
  "- payment = แจ้งโอน/ส่งสลิป/ถามวิธีชำระเงิน",
  "- shipping_address = แจ้งที่อยู่/ขอให้จัดส่ง",
  "- order_status = ติดตามพัสดุ/สถานะออเดอร์",
  "- price_negotiation = ต่อราคา/ขอส่วนลด",
  "- claim_or_return = เคลม/คืน/เปลี่ยนสินค้า/ของเสีย-ชำรุด",
  "- purchase = ตกลงซื้อ/สั่งเลย/เอาตัวนี้/ถามเลขบัญชี-วิธีโอนเพื่อจะจ่าย/ขอให้ทำหรือออกใบเสนอราคา (รวม quotation/quote) เพราะเป็นการขอให้ร้านดำเนินงานขายแล้ว ไม่ใช่แค่ถามราคา",
  "- greeting = ทักทายอย่างเดียว (สวัสดี/หวัดดี)",
  "- social = ขอบคุณ/ตอบรับสั้น ๆ ที่ไม่ต้องการคำตอบ (ครับ/ค่ะ/โอเค/รับทราบ/จ้า)",
  "- smalltalk = ถามตัวตน/ความสามารถ/คุยเล่นที่ต้องการคำตอบ (จูนคือใคร, เป็นบอทไหม, เป็นคนหรือ AI, ชื่ออะไร, ทำอะไรได้บ้าง, เก่งจัง)",
  "- out_of_scope = ถามเรื่องที่ไม่เกี่ยวกับร้านอะไหล่แอร์รถยนต์เลย (ดินฟ้าอากาศ, การเมือง, เรื่องส่วนตัว, ขำขัน, เรื่องทั่วไป)",
  "- other = ไม่แน่ใจ/จัดกลุ่มไม่ได้",
  "",
  "กฎ:",
  "- ถ้าไม่มั่นใจว่าเข้ากลุ่มไหน ให้ตอบ group=other (อย่าเดาเป็น product)",
  "- ให้โฟกัสเจตนาของข้อความล่าสุด: ถ้าลูกค้าขอใบเสนอราคา/quotation/quote ให้เป็น purchase แม้ประวัติก่อนหน้าจะกำลังถามหาสินค้า และห้ามดึงชื่อสินค้าเดิมมาทำให้ข้อความล่าสุดกลายเป็น product",
  "- query ใส่เฉพาะเมื่อ group=product หรือ stock_availability เท่านั้น (กลุ่มอื่นใส่ null) — และรวมข้อมูลที่ทยอยพิมพ์หลายข้อความเข้าด้วยกัน",
  "- ถ้า group=stock_availability แต่บทสนทนาก่อนหน้าเคยเอ่ยถึงอะไหล่/รถ ให้กรอก partType/carBrand/carModel/year เท่าที่ลูกค้าเคยระบุ (เหมือน product) — ห้ามแต่งเอง",
  "- แปลงปีย่อ 2 หลักเป็น ค.ศ. 4 หลัก เช่น '06' → 2006; ปี พ.ศ. เช่น 2560 → 2017",
  "- ห้ามแต่งข้อมูลที่ลูกค้าไม่ได้พูด ฟิลด์ใดไม่ทราบให้ใส่ null",
  "- partKind/tooBroad ใส่เฉพาะเมื่อ group=product หรือ stock_availability เท่านั้น (กลุ่มอื่น partKind=null, tooBroad=false)",
  "- subjects: แยกเป็นหลายรายการเฉพาะเมื่อ 'ชนิดอะไหล่ต่างกัน' ตั้งแต่ 2 ชนิด; รุ่นรถต่างกันแต่ชนิดเดียว = subjects ว่าง ([])",
].join("\n");

const MAX_CONSOLIDATED_QUERY_LENGTH = 120;
const MIN_SEARCH_YEAR = 1950;
const MAX_SEARCH_YEAR = 2100;

/** Classified intent + structured search hints distilled from the conversation.
 *  `group` drives routing (product / shop_info / payment / ... / other). `query`
 *  and the fitment hints are only meaningful for `group === "product"`.
 *  `isProductQuery` is kept as a convenience mirror of `group === "product"`. */
export type ChatPartKind = "fitment" | "universal";

/** One distinct product subject the customer asked about (B2c). A single message
 *  can carry several when the customer lists multiple part TYPES at once
 *  ("คอมแอร์กับคอยเย็น D-Max"). Different car models for the SAME part type are NOT
 *  separate subjects (per decision 1 = ก) — those stay in the consolidated query. */
export type ChatSubject = {
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
  partKind: ChatPartKind | null;
  query: string;
};

export type ChatSearchIntent = {
  group: ChatMessageGroup;
  query: string;
  isProductQuery: boolean;
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
  /** Whether the part needs a vehicle to find (fitment) or is searchable on its
   *  own name/spec (universal). Null when unknown / non-product. */
  partKind: ChatPartKind | null;
  /** The query is too generic to search usefully (e.g. "น็อต" alone) → ask first. */
  tooBroad: boolean;
  /** B2c: when the customer asks for ≥2 DISTINCT part types in one turn, each is
   *  listed here so the caller can answer them in separate blocks. The top-level
   *  fields above always mirror the FIRST subject (back-compat). Absent / length
   *  ≤1 means a single-subject turn (answer normally). */
  subjects?: ChatSubject[];
};

const cleanIntentString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\r\n]+/g, " ").trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toUpperCase() === "NONE") return null;
  return trimmed;
};

const cleanIntentYear = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isInteger(num)) return null;
  // Fold a Buddhist-era year to Gregorian BEFORE validating/returning — the DB
  // stores Gregorian fitment years, so a พ.ศ. value (e.g. 2560) must search as ค.ศ.
  // (2017), never as the raw B.E. number (which would match nothing).
  const gregorian = toGregorianCarYear(num);
  if (gregorian < MIN_SEARCH_YEAR || gregorian > MAX_SEARCH_YEAR) return null;
  return gregorian;
};

/**
 * Parses the model's JSON reply into a ChatSearchIntent. Pure + defensive: strips
 * markdown fences, tolerates extra prose around the object, and returns null when
 * there's no usable `query`. Exported for unit testing.
 */
export const parseChatSearchIntent = (raw: string): ChatSearchIntent | null => {
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
  const group: ChatMessageGroup = isChatMessageGroup(groupRaw)
    ? groupRaw
    : obj.isProductQuery === true
      ? "product"
      : obj.isProductQuery === false
        ? "other"
        : "other";

  const query = cleanIntentString(obj.query);
  const isProductQuery = group === "product";
  // stock_availability keeps its product-detail fields (partType/car/partKind) —
  // the processor uses them to decide search-vs-handoff, and normalizes the
  // intent to a product turn when the customer named searchable detail.
  const isProductLike = isProductQuery || group === "stock_availability";

  const partKindRaw = typeof obj.partKind === "string" ? obj.partKind.trim().toLowerCase() : "";
  const partKind: ChatPartKind | null =
    isProductLike && (partKindRaw === "fitment" || partKindRaw === "universal") ? partKindRaw : null;

  // B2c: parse the optional multi-subject list. Only product turns can carry it,
  // and only entries with a real partType count as a distinct subject (an empty /
  // partType-less entry is noise). Kept undefined for the common single-subject
  // case so existing callers are unaffected.
  let subjects: ChatSubject[] | undefined;
  if (isProductQuery && Array.isArray(obj.subjects)) {
    const parsed = obj.subjects
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s): ChatSubject => {
        const sKindRaw = typeof s.partKind === "string" ? s.partKind.trim().toLowerCase() : "";
        const sQuery = cleanIntentString(s.query);
        return {
          partType: cleanIntentString(s.partType),
          carBrand: cleanIntentString(s.carBrand),
          carModel: cleanIntentString(s.carModel),
          year: cleanIntentYear(s.year),
          partKind: sKindRaw === "fitment" || sKindRaw === "universal" ? sKindRaw : null,
          query: sQuery ? sQuery.slice(0, MAX_CONSOLIDATED_QUERY_LENGTH).trim() : "",
        };
      })
      .filter((s) => s.partType !== null);
    if (parsed.length >= 2) subjects = parsed;
  }

  return {
    group,
    query: query ? query.slice(0, MAX_CONSOLIDATED_QUERY_LENGTH).trim() : "",
    isProductQuery,
    partType: cleanIntentString(obj.partType),
    carBrand: cleanIntentString(obj.carBrand),
    carModel: cleanIntentString(obj.carModel),
    year: cleanIntentYear(obj.year),
    partKind,
    tooBroad: isProductLike && obj.tooBroad === true,
    ...(subjects ? { subjects } : {}),
  };
};

/**
 * Classifies the latest message into a {@link ChatMessageGroup} AND, for product
 * turns, distils the consolidated search query + fitment hints from the whole
 * conversation (so drip-fed details "คอยเย็น d max" → "ปี 06" search the COMBINED
 * subject). Runs on EVERY text turn (first turn included) so routing is robust to
 * phrasing — the caller (processor) decides when to skip it (e.g. a keyword guard
 * hit). The `intent` arg is unused now but kept for the dependency signature.
 *
 * Returns null only when Gemini is unavailable or the reply can't be parsed — the
 * caller then falls back to the deterministic Layer-1 (regex) routing.
 */
export async function extractChatSearchIntent(input: {
  intent: LineIntent;
  latestText?: string | null;
  history?: ChatReplyHistoryItem[];
}): Promise<ChatSearchIntent | null> {
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
      maxOutputTokens: CHAT_SEARCH_INTENT_MAX_OUTPUT_TOKENS,
      temperature: 0,
      json: true,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });

    return parseChatSearchIntent(text);
  } catch {
    return null;
  }
}

function buildLineReplyPrompt(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: ChatProductSearchBridgeResult | null;
  history?: ChatReplyHistoryItem[];
  products?: ChatProductSummary[];
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
      const codePart = product.code ? ` (รหัส ${product.code})` : "";
      lines.push(`- ${product.name}${codePart} [ราคา ${formatProductPrice(product.salePrice)}]`);
    }
    lines.push(
      "ให้นำเสนอรายการเหล่านี้กับลูกค้าได้เลยเพื่อช่วยตัดสินใจเบื้องต้น โดยใช้ชื่อสินค้า/รหัส/ราคาตามนี้เป๊ะ ห้ามแต่งชื่อ/รหัส/ราคาเพิ่มเอง",
    );
    lines.push(
      // The customer's part word may be misspelled or ambiguous (e.g. typed
      // "วาว์ล"/"วาล์วน้ำ" for what the catalog calls "วาล์วแอร์"). Naming the part
      // from the raw text makes the prose disagree with the products/cards shown.
      "เมื่อกล่าวถึง 'ชนิดอะไหล่' ในข้อความเปิดหรือปิดท้าย ให้ยึดชื่อชนิดอะไหล่ตามรายการสินค้าที่พบในระบบด้านบนเท่านั้น ห้ามเรียกชื่อชนิดอะไหล่ตามคำที่ลูกค้าพิมพ์ซึ่งอาจสะกดผิดหรือกำกวม (เช่น ลูกค้าพิมพ์ 'วาว์ล' หรือ 'วาล์วน้ำ' แต่รายการที่พบเป็น 'วาล์วแอร์' ให้เรียกว่า 'วาล์วแอร์')",
    );
    lines.push(
      "สำคัญ: เรียงรายการในคำตอบ 'ตามลำดับที่ให้มาเป๊ะ' ห้ามสลับ/จัดลำดับใหม่ เพราะต้องตรงกับการ์ดสินค้าที่ส่งคู่กัน",
    );
    lines.push(
      [
        "รูปแบบการแสดงรายการสินค้า (ต้องทำตามนี้เป๊ะ เพื่อให้แต่ละรายการแยกชัดอ่านง่าย):",
        "- ขึ้นรายการแรกด้วยการเว้นบรรทัดว่าง 1 บรรทัดจากข้อความเปิด",
        "- แต่ละสินค้าขึ้นต้นด้วยเลขลำดับอิโมจิ 1️⃣ 2️⃣ 3️⃣ ... ตามด้วยชื่อสินค้าเต็ม",
        "- บรรทัดถัดมาของสินค้านั้นใส่รหัสและราคาไว้บรรทัดเดียวกันในรูปแบบ '🏷️ <รหัส>  |  💰 <ราคา>'",
        "- ราคาให้ใช้ตามที่ให้มาเป๊ะ: ถ้ามีราคาให้แสดง '฿<จำนวน>' ถ้าไม่มีราคา/เป็น 0 ให้แสดง 'สอบถามราคา'",
        "- ถ้าสินค้าไม่มีรหัส ให้แสดงเฉพาะราคาในรูปแบบ '💰 <ราคา>' (ไม่ต้องมี 🏷️ และเครื่องหมาย |)",
        "- คั่นระหว่างสินค้าแต่ละรายการด้วยเส้น '━━━━━━━━━━━━━━' บรรทัดเดียว",
        "- หลังรายการสุดท้ายเว้นบรรทัดว่าง 1 บรรทัดก่อนข้อความปิดท้าย",
        "ตัวอย่างรูปแบบ:",
        "1️⃣ ชื่อสินค้า A",
        "🏷️ P0001  |  💰 ฿350",
        "━━━━━━━━━━━━━━",
        "2️⃣ ชื่อสินค้า B",
        "🏷️ P0002  |  💰 สอบถามราคา",
      ].join("\n"),
    );
    lines.push(
      "ย้ำกับลูกค้าว่าเป็นการเทียบเบื้องต้นจากข้อมูลที่ได้ และแนะนำให้ตรวจสอบ/ยืนยันความเข้ากันกับทางร้านอีกครั้งก่อนสั่งซื้อ ไม่ต้องบังคับให้ลูกค้าระบุเลขตัวถังหรือรหัส OEM",
    );
    lines.push(
      "ห้ามตัดสิน/สรุปแทนลูกค้าว่ารายการที่พบ \"ใช้ได้\" หรือ \"ใช้ไม่ได้\" กับรถของลูกค้า แม้ปีในชื่อสินค้าจะดูไม่ตรง ให้เสนอเป็นตัวเลือกใกล้เคียงและชวนเทียบกับอะไหล่ตัวเดิมเสมอ",
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

/** Customer-facing sale-price label, mirrored from the flex product card so the
 *  list text and the cards never disagree: "฿1,200" when priced, "สอบถามราคา"
 *  when the price is missing/zero. */
function formatProductPrice(salePrice: number): string {
  return salePrice > 0 ? `฿${salePrice.toLocaleString("th-TH")}` : "สอบถามราคา";
}

/**
 * Formats matched products as a clear, separated list block (style A): each item
 * is numbered, with the product code and sale price on one shared "meta" line
 * (🏷️ <code> | 💰 <price>), and items are split by a divider so they read as
 * distinct entries. When a product has no code, only the price is shown. Shared
 * by every customer-facing list reply so the deterministic templates and the
 * live AI path stay visually identical. Returns "" when there are no products.
 */
export function formatProductListBlock(products: ChatProductSummary[]): string {
  return products
    .slice(0, 5)
    .map((product, index) => {
      const number = PRODUCT_LIST_NUMBER_EMOJI[index] ?? `${index + 1}.`;
      const priceLabel = `💰 ${formatProductPrice(product.salePrice)}`;
      const metaLine = product.code ? `🏷️ ${product.code}  |  ${priceLabel}` : priceLabel;
      return `${number} ${product.name}\n${metaLine}`;
    })
    .join(`\n${PRODUCT_LIST_DIVIDER}\n`);
}

export function buildConservativeChatSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: ChatProductSearchBridgeResult | null;
  products?: ChatProductSummary[];
}): ChatAiSuggestionDraft {
  if (input.intent === LineIntent.GREETING) {
    return {
      suggestedReply: "สวัสดีค่ะ 😊 จูนช่วยหาอะไหล่แอร์และหม้อน้ำรถยนต์ให้ได้เลยค่ะ รบกวนแจ้งรุ่นรถ ปีรถ หรือส่งรูปอะไหล่เดิมมาได้เลยนะคะ",
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
/** Fitment slots already known for the current inquiry (from the carried frame). */
export type ChatKnownFitment = {
  partType: string | null;
  carBrand: string | null;
  carModel: string | null;
  year: number | null;
};

/**
 * Builds a "please tell me X" question that asks ONLY for the slots still missing
 * from the known fitment — never re-asking detail the customer already gave (or
 * that an image already revealed). Returns null when nothing is missing, so the
 * caller can stay silent instead of asking a redundant question.
 */
export function buildMissingFitmentQuestion(known?: ChatKnownFitment | null): string | null {
  const needPart = !known?.partType;
  const needCar = !known?.carBrand && !known?.carModel;
  const needYear = known?.year === null || known?.year === undefined;

  const wants: string[] = [];
  if (needPart) wants.push("ชนิดอะไหล่ (เช่น หม้อน้ำ คอยล์เย็น คอมแอร์)");
  if (needCar) wants.push("ยี่ห้อ/รุ่นรถ");
  if (needYear) wants.push("ปีรถ");

  if (wants.length === 0) return null;
  return `รบกวนแจ้ง ${wants.join(" และ ")} เพิ่มเติมนะคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ 🙏`;
}

export function buildJuneDeadlineReply(input: {
  query?: string | null;
  products?: ChatProductSummary[];
  known?: ChatKnownFitment | null;
}): string {
  const subject = input.query?.trim();
  const products = input.products ?? [];

  if (products.length === 0) {
    // Ask only for what's genuinely missing. When the subject is already complete
    // (part + car + year known) we must NOT re-ask known detail — stay soft/silent.
    const question = buildMissingFitmentQuestion(input.known);
    if (!question) {
      return subject
        ? `สำหรับ "${subject}" จูนขอเช็กข้อมูลเพิ่มอีกนิดแล้วแจ้งกลับนะคะ 🙏`
        : "จูนขอเช็กข้อมูลเพิ่มอีกนิดแล้วแจ้งกลับนะคะ 🙏";
    }
    return subject ? `สำหรับ "${subject}" ${question}` : question;
  }

  const productLines = formatProductListBlock(products);

  const opener = subject
    ? `สำหรับ "${subject}" เบื้องต้นจูนเจอรายการที่ใกล้เคียงในร้านดังนี้ค่ะ 😊`
    : "เบื้องต้นจูนเจอรายการที่ใกล้เคียงในร้านดังนี้ค่ะ 😊";

  return `${opener}\n\n${productLines}\n\nเป็นการเทียบเบื้องต้นนะคะ รบกวนเช็กกับทางร้านอีกครั้งก่อนสั่งซื้อนะคะ 🙏`;
}

/**
 * Reply for when a customer's PART IMAGE was recognized (vision OCR succeeded,
 * not low-confidence) but the product search found no match in the catalog.
 * Acknowledges the part we actually saw — so it never reads like the photo was
 * ignored — and hands off to a human to confirm stock/fitment, instead of the
 * generic FAQ "send a photo of the part" answer that looks absurd right after the
 * customer already sent one.
 */
export function buildJunePartImageNoMatchReply(known?: ChatKnownFitment | null): string {
  const part = known?.partType?.trim();
  const car = [known?.carBrand?.trim(), known?.carModel?.trim()].filter(Boolean).join(" ") || null;
  const subject = part ? (car ? `${part}สำหรับ ${car}` : part) : "อะไหล่ในรูป";
  return `จูนเห็นรูป${subject}ที่ส่งมาแล้วนะคะ 🙏 ขอส่งให้แอดมินช่วยเช็กสต็อกและความเข้ากันให้ชัวร์ก่อนนะคะ เดี๋ยวติดต่อกลับโดยเร็วที่สุดค่ะ 😊`;
}

/**
 * Reply for a TEXT product inquiry where the customer named a specific part (and
 * usually a car) but the automated catalog search needs human confirmation.
 * Acknowledges the exact part +
 * car so it never reads like the request was ignored, then hands off to a human.
 * Mirrors {@link buildJunePartImageNoMatchReply} for the text channel. The part
 * label is cleaned of any "(English)" canonical suffix so the customer sees a
 * natural word ("คอมแอร์" not "คอมแอร์ (Compressor)").
 */
export function buildJuneTextNoMatchHandoffReply(known?: ChatKnownFitment | null): string {
  const part = known?.partType?.trim().replace(/\s*\([^)]*\)\s*$/, "") || null;
  const car = [known?.carBrand?.trim(), known?.carModel?.trim()].filter(Boolean).join(" ") || null;
  const yearPart = known?.year ? ` ปี ${known.year}` : "";
  const subject = part
    ? car
      ? `${part} ${car}${yearPart}`
      : `${part}${yearPart}`
    : "รายการที่แจ้ง";
  return (
    `สำหรับ${subject} จูนขอให้แอดมินช่วยเช็กสต็อกและตัวที่เข้ากันให้ชัวร์ก่อนนะคะ 🙏\n` +
    `เดี๋ยวแอดมินติดต่อกลับโดยเร็วที่สุดค่ะ\n\n` +
    `ถ้ามีรูปอะไหล่เดิมหรือรหัสบนตัวอะไหล่ ส่งเพิ่มมาได้เลยนะคะ จะช่วยให้เทียบแม่นขึ้นค่ะ 😊`
  );
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

/** Deterministic fallback for the `smalltalk` group (identity / capability /
 *  chit-chat that wants an answer) — used when Gemini is unavailable or the
 *  reply-token budget is too low to generate. Always steers back to parts. */
export function buildJuneSmalltalkReply(): string {
  return "จูนเป็นผู้ช่วยร้านศรีวรรณอะไหล่แอร์ค่ะ 😊 ช่วยค้นหาอะไหล่แอร์รถยนต์ให้ตรงรุ่นได้เลยนะคะ ลองส่งรุ่นรถ ปีรถ หรือรูปอะไหล่เดิมมาได้เลยค่ะ 🚗";
}

/** Deterministic fallback for the `out_of_scope` group — politely declines the
 *  off-topic request and steers back to parts. */
export function buildJuneOutOfScopeReply(): string {
  return "ขอโทษนะคะ จูนดูแลเฉพาะเรื่องอะไหล่แอร์รถยนต์ค่ะ 🙏 ถ้าต้องการหาอะไหล่ บอกรุ่นรถ ปีรถ หรือส่งรูปอะไหล่เดิมมาได้เลยนะคะ เดี๋ยวจูนช่วยเช็กให้ค่ะ 😊";
}

/**
 * Per-group scope guardrail for the conversational groups. Lets the model write
 * the wording itself while hard-bounding what it may talk about and forcing it
 * to steer back to finding parts. The global safety rules in
 * {@link LINE_AI_SYSTEM_INSTRUCTION} (no fabricated price/stock, no promises)
 * still apply on top of these.
 */
const SCOPED_CONVERSATIONAL_DIRECTIVE: Partial<Record<ChatMessageGroup, string>> = {
  smalltalk: [
    "บริบท: ลูกค้าทักทาย/ถามตัวตน/ถามความสามารถ/คุยเล่น (เช่น 'จูนคือใคร' 'เป็นบอทไหม' 'ทำอะไรได้')",
    "ให้แนะนำตัวสั้น ๆ ว่าเป็น 'จูน' ผู้ช่วยร้านศรีวรรณอะไหล่แอร์ อย่างเป็นกันเอง 1-2 บรรทัด",
    "ตอบคำถามตามจริงได้ (เช่น เป็นผู้ช่วย AI ของร้าน) แต่ห้ามออกนอกบทบาทแอดมินร้านอะไหล่",
    "แล้ว 'วกกลับ' ชวนลูกค้าบอกรุ่นรถ/ปีรถ หรือส่งรูปอะไหล่เดิม เพื่อช่วยค้นหาอะไหล่ ปิดท้ายด้วยการชวนเรื่องอะไหล่เสมอ",
  ].join("\n"),
  out_of_scope: [
    "บริบท: ลูกค้าถามเรื่องที่ไม่เกี่ยวกับร้านอะไหล่แอร์รถยนต์เลย",
    "ให้ปฏิเสธอย่างสุภาพและเป็นมิตรว่าจูนดูแลเฉพาะเรื่องอะไหล่แอร์รถยนต์",
    "ห้ามให้ข้อมูล ความเห็น หรือคำตอบเรื่องนอกขอบเขตนั้น (เช่น การเมือง ดินฟ้าอากาศ เรื่องส่วนตัว)",
    "แล้ววกกลับชวนลูกค้าให้สอบถามอะไหล่แอร์ที่ต้องการ ปิดท้ายด้วยการชวนเรื่องอะไหล่",
  ].join("\n"),
};

/**
 * Generates a scoped, จูน-voiced reply for a conversational group
 * (`smalltalk` / `out_of_scope`). The model writes the wording but the
 * per-group directive + global system instruction hard-bound the scope and
 * force a steer back to finding parts. Any failure (no keys, timeout, empty)
 * degrades to the deterministic template so the customer always gets a reply.
 */
export async function generateScopedConversationalReply(input: {
  group: ChatMessageGroup;
  latestText?: string | null;
  history?: ChatReplyHistoryItem[];
}): Promise<string> {
  const fallback =
    input.group === "out_of_scope" ? buildJuneOutOfScopeReply() : buildJuneSmalltalkReply();
  const directive = SCOPED_CONVERSATIONAL_DIRECTIVE[input.group];
  if (!directive || !hasGeminiKeysConfigured()) return fallback;

  try {
    const lines: string[] = [];
    if (input.history && input.history.length > 0) {
      lines.push("ประวัติการสนทนาก่อนหน้า (เก่าสุด → ใหม่สุด) ใช้เป็นบริบท:");
      for (const turn of input.history) {
        lines.push(`${turn.role === "customer" ? "ลูกค้า" : "ร้าน"}: ${turn.text}`);
      }
      lines.push("");
    }
    lines.push(`ข้อความล่าสุดจากลูกค้า: ${input.latestText?.trim() || "(ไม่มีข้อความ)"}`);
    lines.push("");
    lines.push(directive);
    lines.push("กรุณาร่างข้อความตอบลูกค้า 1 ข้อความ สั้น กระชับ ไม่เกิน 3 บรรทัด ตามกฎความปลอดภัยทั้งหมด");

    const { text } = await generateGeminiContent({
      prompt: lines.join("\n"),
      systemInstruction: LINE_AI_SYSTEM_INSTRUCTION,
      maxOutputTokens: 400,
      temperature: 0.5,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });

    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}
