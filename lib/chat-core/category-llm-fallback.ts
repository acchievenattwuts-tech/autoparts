import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { CHAT_CALL_TIMEOUT_MS, CHAT_MAX_KEY_ATTEMPTS } from "@/lib/chat-core/ai-service";

/**
 * LLM fallback for category resolution — runs ONLY when the deterministic
 * resolver (CategoryAlias + dictionary) could not map the customer's part word
 * to a category. It does exactly one narrow job: identify the AC/radiator PART
 * word the customer meant and return its corrected canonical Thai spelling.
 *
 * It deliberately does NOT choose a category. The caller feeds `corrected` back
 * through the deterministic resolver; the category is applied only if that maps
 * to exactly one active category — so the ">95% confidence" bar is enforced by
 * the real alias table, never by a self-reported LLM score.
 */

export type PartSpellingCorrection = {
  /** The misspelled part word as the customer wrote it (for staging as an alias). */
  original: string;
  /** The corrected canonical Thai part word (for re-mapping + the synonym term). */
  corrected: string;
};

const CORRECTION_PROMPT = [
  "คุณเป็นผู้เชี่ยวชาญอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์",
  "ระบบไม่สามารถระบุ 'ชนิดอะไหล่' จากข้อความลูกค้าได้ (อาจสะกดผิด/พิมพ์ติดกัน)",
  "งานของคุณ: หาคำที่เป็น 'ชนิดอะไหล่' ที่ลูกค้าน่าจะหมายถึง แล้วแก้ให้เป็นคำมาตรฐานภาษาไทยที่ถูกต้อง",
  "ตัวอย่าง: 'วาว์ล' → 'วาล์วแอร์', 'คอมมิวเตอร' ไม่ใช่ชนิดอะไหล่ (เป็นรุ่นรถ) ให้ข้าม",
  "ห้ามเดาชนิดอะไหล่ที่ลูกค้าไม่ได้พิมพ์ถึง ถ้าไม่พบคำที่เป็นชนิดอะไหล่ ให้ตอบค่าว่าง",
  "original = คำที่ลูกค้าพิมพ์จริง (ตามต้นฉบับ), corrected = คำที่ถูกต้อง",
  'ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown: {"original":"...","corrected":"..."} หรือ {"original":"","corrected":""}',
].join("\n");

/**
 * Returns the corrected part spelling, or null when Gemini is unavailable, the
 * call fails, or no part word could be identified. Never throws.
 */
export async function correctPartSpelling(
  rawText: string | null | undefined,
  context?: { carBrand?: string | null; carModel?: string | null },
): Promise<PartSpellingCorrection | null> {
  const text = rawText?.trim();
  if (!text || !hasGeminiKeysConfigured()) return null;

  const vehicleHint = [context?.carBrand, context?.carModel].filter(Boolean).join(" ");
  const prompt =
    `${CORRECTION_PROMPT}\n\nข้อความลูกค้า: ${text}` +
    (vehicleHint ? `\n(รถที่ระบุแล้ว: ${vehicleHint} — ไม่ต้องนำมาเป็นชนิดอะไหล่)` : "");

  try {
    const { text: raw } = await generateGeminiContent({
      prompt,
      json: true,
      maxOutputTokens: 80,
      temperature: 0,
      thinkingLevel: "NONE",
      timeoutMs: CHAT_CALL_TIMEOUT_MS,
      maxKeyAttempts: CHAT_MAX_KEY_ATTEMPTS,
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      original?: unknown;
      corrected?: unknown;
    };
    const corrected = typeof parsed.corrected === "string" ? parsed.corrected.trim() : "";
    const original = typeof parsed.original === "string" ? parsed.original.trim() : "";
    if (!corrected) return null;
    return { original: original || corrected, corrected };
  } catch {
    return null;
  }
}
