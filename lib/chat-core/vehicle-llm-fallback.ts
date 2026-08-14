import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { CHAT_CALL_TIMEOUT_MS, CHAT_MAX_KEY_ATTEMPTS } from "@/lib/chat-core/ai-service";

/**
 * LLM fallback for CAR MODEL resolution — the vehicle-side twin of
 * {@link ./category-llm-fallback.correctPartSpelling}.
 *
 * Part words already self-heal: an unmapped spelling goes to the LLM, is re-mapped
 * through the real alias table, and the misspelling is staged for admin approval so
 * it resolves deterministically forever after. Vehicles had NO such loop —
 * {@link ../chat-core/fitment-resolve.resolveCanonicalCarModelHint} is an exact map
 * lookup over `SearchSynonym`, with no edit distance and no fallback. A model that
 * is not already a known spelling simply fails to resolve, the vehicle-unresolved
 * guard hands off, and the same misspelling fails identically next week. Measured
 * on production: 44.9% of chat product turns resolved no car model.
 *
 * Exactly like the category fallback, this does NOT choose a vehicle. It only
 * returns the corrected canonical spelling; the caller re-resolves that through the
 * real `CarModel` / `CarBrand` master tables and applies it ONLY when it maps to a
 * single active row. The confidence bar is enforced by master data, never by a
 * self-reported score.
 */

export type VehicleSpellingCorrection = {
  /** The misspelled vehicle word as the customer wrote it (for staging). */
  original: string;
  /** The corrected canonical model/brand spelling (for re-mapping). */
  corrected: string;
};

const CORRECTION_PROMPT = [
  "คุณเป็นผู้เชี่ยวชาญรถยนต์ที่ขายในประเทศไทย",
  "ระบบไม่สามารถระบุ 'ยี่ห้อ/รุ่นรถ' จากข้อความลูกค้าได้ (อาจสะกดผิด/พิมพ์ติดกัน/พิมพ์ทับศัพท์)",
  "งานของคุณ: หาคำที่เป็น 'ชื่อรุ่นรถ' ที่ลูกค้าน่าจะหมายถึง แล้วแก้ให้เป็นชื่อรุ่นมาตรฐาน",
  "ตัวอย่าง: 'ฟอจูเนอ' → 'Fortuner', 'ดีแม็ค' → 'D-Max', 'วีโก' → 'Vigo'",
  "ห้ามเดารุ่นรถที่ลูกค้าไม่ได้พิมพ์ถึง — ถ้าข้อความมีแต่ชื่ออะไหล่ (เช่น 'คอยล์เย็น' 'หม้อน้ำ') ให้ตอบค่าว่าง",
  "ถ้าลูกค้าพิมพ์แค่ปีรถ หรือแค่เลขรุ่นอะไหล่ ให้ตอบค่าว่าง",
  "original = คำที่ลูกค้าพิมพ์จริง (ตามต้นฉบับ), corrected = ชื่อรุ่นที่ถูกต้อง",
  'ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown: {"original":"...","corrected":"..."} หรือ {"original":"","corrected":""}',
].join("\n");

/**
 * Returns the corrected vehicle spelling, or null when Gemini is unavailable, the
 * call fails, or no vehicle word could be identified. Never throws.
 */
export async function correctVehicleSpelling(
  rawText: string | null | undefined,
  context?: { partType?: string | null },
): Promise<VehicleSpellingCorrection | null> {
  const text = rawText?.trim();
  if (!text || !hasGeminiKeysConfigured()) return null;

  const partHint = context?.partType?.trim();
  const prompt =
    `${CORRECTION_PROMPT}\n\nข้อความลูกค้า: ${text}` +
    (partHint ? `\n(ชนิดอะไหล่ที่ระบุแล้ว: ${partHint} — ไม่ต้องนำมาเป็นชื่อรุ่นรถ)` : "");

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
