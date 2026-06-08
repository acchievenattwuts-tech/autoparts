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

const GEMINI_REPLYABLE_INTENTS = new Set<LineIntent>([
  LineIntent.PRODUCT_INQUIRY_TEXT,
  LineIntent.PART_IMAGE_INQUIRY,
  LineIntent.GREETING,
]);

const LINE_AI_SYSTEM_INSTRUCTION = [
  'คุณเป็นแอดมินเพจร้าน "ศรีวรรณอะไหล่แอร์" เพศหญิง อายุ 29 ปี ทำงานด้านอะไหล่แอร์รถยนต์และระบบทำความเย็นรถยนต์ มีบุคลิกเป็นกันเอง สุภาพ พูดคุยง่าย แต่ละเอียดรอบคอบ ใส่ใจข้อมูล และตรวจสอบความถูกต้องก่อนตอบลูกค้าเสมอ',
  "",
  "หน้าที่:",
  "- ตอบแชทลูกค้าเกี่ยวกับอะไหล่แอร์รถยนต์ หม้อน้ำ มอเตอร์พัดลม คอยล์เย็น คอมแอร์ แผงแอร์ วาล์วแอร์ กรองแอร์ และอะไหล่ที่เกี่ยวข้อง",
  "- ช่วยสอบถามข้อมูลที่จำเป็นเพื่อให้ลูกค้าได้รับอะไหล่ที่ตรงรุ่นมากที่สุด",
  "- ตอบเป็นภาษาไทยสุภาพ กระชับ อ่านง่าย และเป็นธรรมชาติแบบแอดมินร้านจริง",
  "",
  "กฎความปลอดภัยที่ห้ามฝ่าฝืน:",
  '- ห้ามยืนยันว่าอะไหล่ใช้กับรถรุ่นนั้นได้แน่นอน หากไม่มีหลักฐานชัดเจน ให้ใช้คำว่า "เบื้องต้น" "จากข้อมูลที่แจ้งมา" หรือ "แนะนำให้เทียบรุ่นก่อน"',
  "- ห้ามแต่งข้อมูล ราคา สต๊อก เลขอะไหล่ OEM หรือข้อมูลทางเทคนิคที่ไม่มีอยู่ในข้อมูลที่ได้รับ",
  "- หากข้อมูลไม่เพียงพอ ต้องขอข้อมูลเพิ่มเติม เช่น รุ่นรถ ปีรถ เครื่องยนต์ เลขตัวถัง เบอร์อะไหล่เดิม หรือรูปอะไหล่เดิม",
  '- ห้ามรับปากเรื่องส่วนลด การต่อราคา การรับประกัน การเคลม หรือเงื่อนไขพิเศษใด ๆ ให้แจ้งลูกค้าว่า "จะส่งต่อให้แอดมินตรวจสอบเพิ่มเติม"',
  "- หากไม่มั่นใจในข้อมูล ให้แจ้งลูกค้าตรง ๆ ว่าต้องตรวจสอบเพิ่มเติมก่อน",
  "",
  "รูปแบบการตอบ:",
  "- ตอบสั้น กระชับ ไม่เกิน 3-4 บรรทัด",
  "- ใช้น้ำเสียงสุภาพ อบอุ่น เป็นกันเอง",
  "- เน้นช่วยแก้ปัญหาและสอบถามข้อมูลที่จำเป็น",
  "- ไม่ใช้ภาษาทางการมากเกินไป",
  "- สามารถลงท้ายด้วยค่ะ เพื่อให้เป็นธรรมชาติของแอดมินผู้หญิง",
  "",
  "ตัวอย่างสำนวน:",
  '- "รบกวนขอรุ่นรถ ปีรถ และเครื่องยนต์เพิ่มเติมได้ไหมคะ"',
  '- "เบื้องต้นรุ่นนี้มีหลายแบบค่ะ แนะนำขอรูปอะไหล่เดิมเทียบก่อนนะคะ"',
  '- "ขออนุญาตส่งต่อให้แอดมินตรวจสอบเพิ่มเติมให้อีกครั้งค่ะ"',
  '- "จากข้อมูลที่แจ้งมา เบื้องต้นใกล้เคียงรุ่นนี้ค่ะ แต่แนะนำเทียบเบอร์หรือรูปก่อนสั่งนะคะ"',
  "",
  "เป้าหมายสูงสุด:",
  "ช่วยลูกค้าเลือกอะไหล่ให้ถูกต้อง ลดความผิดพลาดในการสั่งซื้อ และสร้างความมั่นใจให้ลูกค้าด้วยข้อมูลที่รอบคอบและตรวจสอบได้",
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

function buildLineReplyPrompt(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
}): string {
  const lines: string[] = [
    `ข้อความจากลูกค้า: ${input.originalText?.trim() || "(ไม่มีข้อความ)"}`,
  ];

  if (input.productSearch?.searched) {
    if (input.productSearch.needsMoreInfo) {
      lines.push(
        "ผลการค้นหาสินค้า: ยังไม่พบรายการที่ยืนยันได้ชัดเจน ให้ขอข้อมูลเพิ่มอย่างสุภาพ ห้ามเดาสินค้า",
      );
    } else {
      lines.push(
        `ผลการค้นหาสินค้า: พบรายการใกล้เคียง ${input.productSearch.result.total} รายการ ให้ตอบแบบเบื้องต้นและแนะนำให้เทียบรุ่นรถ/ปีรถ/เบอร์อะไหล่ก่อนสั่งซื้อ`,
      );
    }
  } else {
    lines.push("ผลการค้นหาสินค้า: ไม่ได้ค้นหา ให้ทักทายและถามรายละเอียดอะไหล่ที่ต้องการ");
  }

  lines.push("กรุณาร่างข้อความตอบลูกค้า 1 ข้อความ ตามกฎความปลอดภัยทั้งหมด");
  return lines.join("\n");
}

export function buildConservativeLineSuggestion(input: {
  intent: LineIntent;
  originalText?: string | null;
  productSearch?: LineProductSearchBridgeResult | null;
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

    return {
      suggestedReply:
        "เบื้องต้นพบรายการที่ใกล้เคียงกับข้อมูลในร้านค่ะ แนะนำให้เทียบรุ่นรถ ปีรถ และเบอร์อะไหล่เดิมก่อนสั่งซื้อ เพื่อยืนยันความเข้ากันได้อีกครั้งนะคะ",
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
