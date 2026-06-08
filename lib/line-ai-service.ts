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
  "คุณเป็นผู้ช่วยตอบแชทของร้านอะไหล่แอร์รถยนต์ในประเทศไทย ตอบเป็นภาษาไทยสุภาพ กระชับ",
  "กฎความปลอดภัยที่ห้ามฝ่าฝืน:",
  "- ห้ามยืนยันว่าอะไหล่ใช้กับรถรุ่นนั้นได้แน่นอน ถ้าไม่มีหลักฐานชัดเจน ให้ใช้คำว่า 'เบื้องต้น' หรือ 'แนะนำให้เทียบรุ่นก่อน'",
  "- ห้ามแต่งราคา สต๊อก หรือเลขอะไหล่ที่ไม่มีในข้อมูลที่ให้มา",
  "- ถ้าข้อมูลไม่พอ ให้ขอข้อมูลเพิ่ม เช่น รุ่นรถ ปีรถ เครื่องยนต์ เบอร์อะไหล่เดิม หรือรูปอะไหล่",
  "- ห้ามรับปากเรื่องการต่อราคา การเคลม หรือการรับประกัน ให้บอกว่าจะส่งต่อให้แอดมิน",
  "- ตอบสั้นกระชับไม่เกิน 3-4 บรรทัด",
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
      maxOutputTokens: 400,
      temperature: 0.4,
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
      suggestedReply: "สวัสดีครับ ต้องการสอบถามอะไหล่แอร์รถยนต์รุ่นไหน ส่งรุ่นรถ ปีรถ หรือรูปอะไหล่เดิมมาได้เลยครับ",
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
          "ตอนนี้ยังไม่พบข้อมูลที่ยืนยันได้ชัดเจนครับ รบกวนส่งรุ่นรถ ปีรถ เครื่องยนต์ หรือรูปอะไหล่เดิม/เบอร์บนตัวอะไหล่เพิ่ม จะช่วยเทียบให้แม่นขึ้นครับ",
        confidence: LineAiConfidence.NEED_MORE_INFO,
        reasoningSummary: "Product search returned weak/no results.",
        matchedProducts: input.productSearch.result,
      };
    }

    return {
      suggestedReply:
        "เบื้องต้นพบรายการที่ใกล้เคียงกับข้อมูลในร้านครับ แนะนำให้เทียบรุ่นรถ ปีรถ และเบอร์อะไหล่เดิมก่อนสั่งซื้อ เพื่อยืนยันความเข้ากันได้อีกครั้งครับ",
      confidence: LineAiConfidence.POSSIBLE_MATCH,
      reasoningSummary: "Product search returned candidate products; reply remains conservative.",
      matchedProducts: input.productSearch.result,
    };
  }

  return {
    suggestedReply: "เดี๋ยวส่งให้แอดมินช่วยตรวจสอบต่อครับ",
    confidence: LineAiConfidence.ADMIN_REQUIRED,
    reasoningSummary: `Intent ${input.intent} is not safe for automatic detailed reply.`,
  };
}
