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

const SEARCH_QUERY_SYSTEM_INSTRUCTION = [
  "คุณคือตัวช่วยสร้าง 'คำค้นหาสินค้า' ให้ระบบค้นหาอะไหล่แอร์รถยนต์ของร้าน",
  "หน้าที่: อ่านบทสนทนาทั้งหมด แล้วสรุป 'สิ่งที่ลูกค้ากำลังตามหาตอนนี้' ออกมาเป็นคำค้นสั้น ๆ บรรทัดเดียว",
  "",
  "กฎ:",
  "- รวมข้อมูลที่ลูกค้าทยอยพิมพ์มาหลายข้อความให้เป็นคำค้นเดียว (เช่น ข้อความก่อนบอกชนิดอะไหล่+รุ่นรถ ข้อความล่าสุดบอกปี → รวมทั้งหมด)",
  "- รูปแบบที่ต้องการ: ชนิดอะไหล่ + ยี่ห้อ/รุ่นรถ + ปี (เท่าที่ลูกค้าให้มา)",
  "- แปลงปีย่อ 2 หลักเป็นปี ค.ศ. 4 หลัก เช่น 'ปี 06' → '2006', 'ปี 2560' (พ.ศ.) → '2017'",
  "- ห้ามแต่งข้อมูลที่ลูกค้าไม่ได้พูด ห้ามเดารุ่น/ปี/ชนิดอะไหล่เพิ่มเอง",
  "- ตอบเฉพาะคำค้นบรรทัดเดียว ห้ามมีคำอธิบาย ห้ามขึ้นบรรทัดใหม่ ห้ามใส่เครื่องหมายคำพูด",
  "- ถ้าสรุปคำค้นไม่ได้เลย (ลูกค้ายังไม่ได้บอกว่าหาอะไร) ให้ตอบว่า NONE",
].join("\n");

const MAX_CONSOLIDATED_QUERY_LENGTH = 120;

/**
 * Consolidates the running "search subject" from the whole conversation into a
 * single query string, so a customer who drip-feeds details ("คอยเย็น d max" →
 * "ปี 06") gets a search on the COMBINED intent ("คอยล์เย็น d-max 2006") rather
 * than just the latest raw fragment. This is the search-side counterpart to the
 * reply generator, which already reads full history.
 *
 * Returns null whenever Gemini is unavailable, the intent isn't searchable, the
 * model declines (NONE), or anything errors — the caller then falls back to the
 * deterministic query builder (latest text + carried-over fitment terms), so a
 * failure here never blocks or worsens the search.
 */
export async function consolidateLineSearchQuery(input: {
  intent: LineIntent;
  latestText?: string | null;
  history?: LineReplyHistoryItem[];
}): Promise<string | null> {
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
      "สรุปคำค้นหาสินค้าที่ลูกค้ากำลังตามหาตอนนี้ (บรรทัดเดียว):",
    ];

    const { text } = await generateGeminiContent({
      prompt: lines.join("\n"),
      systemInstruction: SEARCH_QUERY_SYSTEM_INSTRUCTION,
      maxOutputTokens: 60,
      temperature: 0,
      thinkingLevel: "NONE",
    });

    const cleaned = text
      .replace(/[\r\n]+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    if (!cleaned || cleaned.toUpperCase() === "NONE") return null;
    return cleaned.slice(0, MAX_CONSOLIDATED_QUERY_LENGTH).trim() || null;
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
