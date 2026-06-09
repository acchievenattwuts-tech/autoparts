import { LineAiConfidence, LineIntent } from "@/lib/generated/prisma";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import type { LineProductSearchBridgeResult } from "@/lib/line-product-search-bridge";

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
  "คุณคือตัวช่วยแยกแยะ 'สิ่งที่ลูกค้ากำลังตามหา' จากบทสนทนา เพื่อป้อนให้ระบบค้นหาอะไหล่แอร์รถยนต์",
  "อ่านบทสนทนาทั้งหมด แล้วตอบกลับเป็น JSON object บรรทัดเดียวเท่านั้น (ไม่มีคำอธิบาย ไม่มี markdown):",
  "",
  "{",
  '  "query": "คำค้นสั้น ๆ รวมทุกอย่างที่ลูกค้าบอก (ชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ + ปี)",',
  '  "partType": "ชนิดอะไหล่ เช่น หม้อน้ำ คอยล์เย็น คอมแอร์ แผงแอร์ กรองแอร์ (ถ้าไม่ทราบใส่ null)",',
  '  "carBrand": "ยี่ห้อรถ เช่น Mazda Toyota Isuzu (ถ้าไม่ทราบใส่ null)",',
  '  "carModel": "รุ่นรถ เช่น Mazda 2, D-Max, Vios (ถ้าไม่ทราบใส่ null)",',
  '  "year": ปีรถเป็นเลข ค.ศ. 4 หลัก หรือ null',
  "}",
  "",
  "กฎ:",
  "- รวมข้อมูลที่ลูกค้าทยอยพิมพ์มาหลายข้อความ (เช่น ก่อนหน้าบอกชนิดอะไหล่+รุ่นรถ ล่าสุดบอกปี → รวมทั้งหมด)",
  "- แปลงปีย่อ 2 หลักเป็น ค.ศ. 4 หลัก เช่น '06' → 2006; ปี พ.ศ. เช่น 2560 → 2017",
  "- ห้ามแต่งข้อมูลที่ลูกค้าไม่ได้พูด ฟิลด์ใดไม่ทราบให้ใส่ null (ยกเว้น query ที่ต้องมีเสมอถ้าลูกค้าบอกว่าหาอะไร)",
  '- ถ้าลูกค้ายังไม่ได้บอกว่าหาอะไรเลย ให้ตอบ {"query": null}',
].join("\n");

const MAX_CONSOLIDATED_QUERY_LENGTH = 120;
const MIN_SEARCH_YEAR = 1950;
const MAX_SEARCH_YEAR = 2100;

/** Structured search intent distilled from the conversation (Part B). `query` is
 *  the consolidated free-text; the rest are optional hard-filter hints resolved
 *  against master data downstream. */
export type LineSearchIntent = {
  query: string;
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
  const query = cleanIntentString(obj.query);
  if (!query) return null;

  return {
    query: query.slice(0, MAX_CONSOLIDATED_QUERY_LENGTH).trim(),
    partType: cleanIntentString(obj.partType),
    carBrand: cleanIntentString(obj.carBrand),
    carModel: cleanIntentString(obj.carModel),
    year: cleanIntentYear(obj.year),
  };
};

/**
 * Extracts the running search intent from the whole conversation so a customer who
 * drip-feeds details ("คอยเย็น d max" → "ปี 06") is searched on the COMBINED subject
 * ("คอยล์เย็น d-max 2006"), and so we can apply precise fitment hard-filters
 * (brand/model/category) resolved downstream — not just free text.
 *
 * Returns null whenever Gemini is unavailable, the intent isn't searchable, the
 * model declines, or anything errors — the caller then falls back to the latest
 * raw text + deterministic fitment carryover, so a failure never worsens search.
 */
export async function extractLineSearchIntent(input: {
  intent: LineIntent;
  latestText?: string | null;
  history?: LineReplyHistoryItem[];
}): Promise<LineSearchIntent | null> {
  const searchable =
    input.intent === LineIntent.PRODUCT_INQUIRY_TEXT || input.intent === LineIntent.PART_IMAGE_INQUIRY;
  // Only worth a model call on a follow-up turn: with no prior history the latest
  // message already IS the full query, so we skip the call entirely (no extra cost).
  if (!searchable || !hasGeminiKeysConfigured() || !input.history || input.history.length === 0) {
    return null;
  }

  try {
    const lines: string[] = [
      "บทสนทนา (เก่าสุด → ใหม่สุด):",
      ...input.history.map((turn) => `${turn.role === "customer" ? "ลูกค้า" : "ร้าน"}: ${turn.text}`),
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

export function buildConservativeLineSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
  products?: LineProductSummary[];
}): LineAiSuggestionDraft {
  if (input.intent === LineIntent.GREETING) {
    return {
      suggestedReply: "สวัสดีค่ะ ต้องการสอบถามอะไหล่แอร์รถยนต์รุ่นไหนดีคะ รบกวนส่งรุ่นรถ ปีรถ หรือรูปอะไหล่เดิมมาได้เลยนะคะ",
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

    const productLines = (input.products ?? [])
      .slice(0, 5)
      .map((product) => `• ${product.name}${product.code ? ` (รหัส ${product.code})` : ""}`)
      .join("\n");

    return {
      suggestedReply: productLines
        ? `เบื้องต้นพบรายการที่ใกล้เคียงในร้านค่ะ 😊\n${productLines}\nเป็นการเทียบเบื้องต้นนะคะ แนะนำให้ตรวจสอบกับทางร้านอีกครั้งก่อนสั่งซื้อค่ะ`
        : "เบื้องต้นพบรายการที่ใกล้เคียงในร้านค่ะ 😊 เป็นการเทียบเบื้องต้น แนะนำให้ตรวจสอบกับทางร้านอีกครั้งก่อนสั่งซื้อนะคะ",
      confidence: LineAiConfidence.POSSIBLE_MATCH,
      reasoningSummary: "Product search returned candidate products; reply remains conservative.",
      matchedProducts: input.productSearch.result,
    };
  }

  return {
    suggestedReply: "ขออนุญาตส่งต่อให้แอดมินตรวจสอบเพิ่มเติมให้อีกครั้งนะคะ",
    confidence: LineAiConfidence.ADMIN_REQUIRED,
    reasoningSummary: `Intent ${input.intent} is not safe for automatic detailed reply.`,
  };
}
