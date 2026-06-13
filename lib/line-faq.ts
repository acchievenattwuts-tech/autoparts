import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { storefrontFaqItems } from "@/lib/storefront-content";
import { CHAT_CALL_TIMEOUT_MS, CHAT_MAX_KEY_ATTEMPTS } from "@/lib/line-ai-service";

/**
 * Answers general customer questions grounded ONLY in the shop's real FAQ
 * (storefrontFaqItems), in จูน's voice. Used as a last chance before an UNKNOWN
 * message is handed to an admin — turning a dead-end into self-service when the
 * answer already exists. Never fabricates: if the FAQ doesn't cover it (or it needs
 * a human action), it returns answered=false so the caller hands off as usual.
 */

const FAQ_CONTEXT = storefrontFaqItems
  .map((item, index) => `${index + 1}. ถาม: ${item.question}\n   ตอบ: ${item.answer}`)
  .join("\n");

const FAQ_SYSTEM_INSTRUCTION = [
  'คุณคือ "จูน" แอดมินร้าน "ศรีวรรณอะไหล่แอร์" จำหน่ายอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ ตอบสุภาพ เป็นกันเอง กระชับ ลงท้ายด้วย "ค่ะ"',
  "ตอบคำถามลูกค้าโดยอ้างอิงจาก FAQ ด้านล่างเท่านั้น ห้ามแต่งข้อมูล/ตัวเลข/เงื่อนไขที่ไม่มีใน FAQ",
  "สำคัญ: ลูกค้ากำลังคุยกับจูนในแชต LINE นี้อยู่แล้ว — ห้ามบอกให้ 'ทัก LINE OA' 'แอดไลน์ร้าน' 'ติดต่อร้านผ่าน LINE' หรือ 'โทรหาร้าน' เพื่อทำสิ่งที่ทำได้ในแชตนี้ (เช่น แจ้งรุ่นรถ ปีรถ ส่งรูปอะไหล่เดิม ถามราคา/สต็อก) ให้เชิญลูกค้าแจ้งข้อมูลหรือส่งรูป 'ตรงนี้ได้เลย' แทน — FAQ บางข้อเขียนไว้สำหรับหน้าเว็บ ต้องปรับถ้อยคำให้เข้ากับบริบทแชต LINE",
  "ถ้าคำถามไม่ได้ถูกครอบคลุมใน FAQ หรือเป็นเรื่องที่ต้องให้แอดมินจัดการ (เช่น ขอเคลม ต่อราคา ยืนยันออเดอร์ แจ้งที่อยู่ ตรวจสลิป) ให้ตอบว่ายังไม่ครอบคลุม",
  'ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown: {"answered": true|false, "reply": "ข้อความตอบสุภาพในนามจูน"}',
  "",
  "FAQ:",
  FAQ_CONTEXT,
].join("\n");

export type LineFaqAnswer = { answered: boolean; reply: string };

const NOT_ANSWERED: LineFaqAnswer = { answered: false, reply: "" };

export async function answerFromLineFaq(input: { text?: string | null }): Promise<LineFaqAnswer> {
  const question = input.text?.trim();
  if (!question || !hasGeminiKeysConfigured()) return NOT_ANSWERED;

  try {
    const { text } = await generateGeminiContent({
      prompt: `คำถามลูกค้า: ${question}`,
      systemInstruction: FAQ_SYSTEM_INSTRUCTION,
      json: true,
      maxOutputTokens: 400,
      temperature: 0.3,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return NOT_ANSWERED;

    const parsed = JSON.parse(text.slice(start, end + 1)) as { answered?: unknown; reply?: unknown };
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return parsed.answered === true && reply ? { answered: true, reply } : NOT_ANSWERED;
  } catch {
    return NOT_ANSWERED;
  }
}
