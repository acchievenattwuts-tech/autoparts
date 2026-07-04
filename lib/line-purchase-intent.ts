import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { CHAT_CALL_TIMEOUT_MS, CHAT_MAX_KEY_ATTEMPTS } from "@/lib/chat-core/ai-service";

/**
 * Lightweight classifier that decides whether a customer message expresses intent
 * to BUY / close the sale (e.g. "เอาตัวนี้", "สั่งเลย", "กี่บาทรวมส่ง", "โอนยังไง").
 *
 * Used as the AI fallback to the keyword router: only called when the cheap
 * keyword pass missed but the customer is plausibly deciding (product inquiry with
 * matches shown). Returns false on any error / missing keys so it never blocks the
 * normal flow — the keyword router remains the deterministic first line.
 */

const PURCHASE_INTENT_PROMPT = [
  "คุณเป็นตัวช่วยจำแนกข้อความลูกค้าในแชทร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์",
  "ตัดสินว่าข้อความนี้แสดง 'ความตั้งใจจะซื้อ/ปิดการขาย' หรือไม่",
  "ความตั้งใจจะซื้อ เช่น: ตกลงเอาสินค้า, ขอสั่งซื้อ, ถามราคารวมเพื่อจะจ่าย, ถามวิธีโอน/ชำระเงิน, ถามวิธีรับของเพื่อจะสั่ง",
  "ไม่ใช่การซื้อ เช่น: ถามข้อมูลทั่วไป, ถามว่ามีของไหม, ขอเทียบรุ่น, ทักทาย",
  'ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown: {"purchase": true|false}',
].join("\n");

export async function classifyPurchaseIntent(text: string | null | undefined): Promise<boolean> {
  const trimmed = text?.trim();
  if (!trimmed || !hasGeminiKeysConfigured()) return false;

  try {
    const { text: raw } = await generateGeminiContent({
      prompt: `${PURCHASE_INTENT_PROMPT}\n\nข้อความลูกค้า: ${trimmed}`,
      json: true,
      maxOutputTokens: 50,
      temperature: 0,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return false;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { purchase?: unknown };
    return parsed.purchase === true;
  } catch {
    return false;
  }
}
