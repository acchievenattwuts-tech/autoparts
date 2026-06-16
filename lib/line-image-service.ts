import { LineIntent } from "@/lib/generated/prisma";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { fetchLineMessageContent, type LineMessageContent } from "@/lib/line-messaging";
import { parsePaymentSlipOcr, type PaymentSlipOcr } from "@/lib/line-payment-slip-service";

// Vision classify is an interactive (reply-token-bound) call: cap the per-key
// HTTP wait and the number of keys tried so one slow/hung key can't stack into
// the 60s webhook budget — especially when several images are classified at
// once. Vision typically returns in a few seconds; 20s is generous headroom.
const VISION_CALL_TIMEOUT_MS = 20_000;
const VISION_MAX_KEY_ATTEMPTS = 3;

export type LineImageKind = "part_image" | "payment_slip" | "unknown_image";
export type LineImageConfidence = "LOW" | "MEDIUM" | "HIGH";

export type LineImagePartKind = "fitment" | "universal";

export type LineImageClassification = {
  kind: LineImageKind;
  intent: LineIntent;
  /** Free-text hints (brand/model/part-number clues) for part images. Empty for slips. */
  searchHints: string[];
  confidence: LineImageConfidence;
  reason: string;
  /** Structured fitment fields read from the SAME vision call (part images only),
   *  so an image-only turn can be put through the same completeness gate as text. */
  partType?: string | null;
  carBrand?: string | null;
  carModel?: string | null;
  year?: number | null;
  partKind?: LineImagePartKind | null;
  /** A part number printed on the item itself (e.g. DENSO 422176-1870) — these
   *  ARE in the catalog and help the search. */
  partNumber?: string | null;
  /** Vehicle chassis / engine / VIN block read off a registration plate
   *  (TFS86HPM7B, MR1TFS86HAT100061, 4JK1…). NEVER used for product search — the
   *  catalog is not indexed by VIN, so feeding these zeroes out the results. */
  chassisNumber?: string | null;
  /** Slip fields read in the SAME vision call (only for payment_slip; else null). */
  ocr?: PaymentSlipOcr | null;
  content?: LineMessageContent;
};

const UNKNOWN_FALLBACK: LineImageClassification = {
  kind: "unknown_image",
  intent: LineIntent.UNKNOWN,
  searchHints: [],
  confidence: "LOW",
  reason: "IMAGE_CLASSIFICATION_UNAVAILABLE",
  ocr: null,
};

const CLASSIFY_PROMPT = [
  "คุณเป็นผู้ช่วยจำแนกรูปภาพที่ลูกค้าส่งเข้ามาในแชทร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์",
  "จำแนกรูปนี้เป็นหนึ่งใน 3 ประเภท:",
  '- "part_image": รูปชิ้นส่วน/อะไหล่ เช่น คอมแอร์ แผงแอร์ คอยล์ ตัวอะไหล่ หรือเบอร์บนอะไหล่',
  '- "payment_slip": สลิป/หลักฐานการโอนเงิน/การชำระเงินจากธนาคารหรือแอปธนาคาร',
  '- "unknown_image": รูปอื่นที่ไม่เข้าสองประเภทข้างต้น',
  "ถ้าเป็น part_image ให้ดึงคำใบ้สำหรับค้นหา (ยี่ห้อ รุ่นรถ ชนิดอะไหล่ ข้อความบนชิ้นส่วน) ใส่ใน searchHints",
  "**ห้ามใส่เลขตัวถัง/เลขเครื่อง/เลขรหัสรุ่นรถ/VIN ลงใน searchHints เด็ดขาด** (เช่น TFS86HPM7B, MR1TFS86HAT100061, 4JK1, GU3115) เพราะใช้ค้นสินค้าไม่ได้ — ให้แยกไปใส่ใน chassisNumber",
  "ถ้าเป็น part_image ให้ระบุข้อมูลแบบมีโครงสร้างด้วย (อ่านจากรูป/ป้ายทะเบียน/ข้อความบนอะไหล่เท่านั้น ไม่เห็นให้ใส่ null):",
  '- partType = ชนิดอะไหล่ (หม้อน้ำ คอยล์เย็น คอมแอร์ ฯลฯ)',
  '- carBrand / carModel = ยี่ห้อ/รุ่นรถ, year = ปี ค.ศ. 4 หลัก',
  '- partNumber = เบอร์อะไหล่ที่พิมพ์บน "ตัวอะไหล่" เอง (เช่น 422176-1870, DI261470-4760) — ใช้ค้นได้',
  '- chassisNumber = เลขตัวถัง/เลขเครื่อง/VIN/รหัสรุ่นรถจากป้ายทะเบียน — ใช้ค้นสินค้าไม่ได้ ห้ามปนกับ partNumber',
  '- partKind = "fitment" (อะไหล่ที่ต้องระบุรุ่นรถ) หรือ "universal" (น้ำยา/น็อต/โอริง/ฟองน้ำ ค้นด้วยชื่อเองได้)',
  "ถ้าเป็น payment_slip ห้ามใส่ searchHints ใด ๆ (ต้องเป็น array ว่าง) และให้อ่านข้อมูลในสลิปใส่ใน ocr ด้วย (อ่านเฉพาะที่เห็นจริง ไม่พบให้ใส่ null)",
  "ถ้าไม่ใช่สลิป ให้ ocr เป็น null",
  "ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown:",
  '{"kind":"part_image|payment_slip|unknown_image","searchHints":["..."],"partType":"...|null","carBrand":"...|null","carModel":"...|null","year":ปีหรือ null,"partNumber":"...|null","chassisNumber":"...|null","partKind":"fitment|universal|null","confidence":"LOW|MEDIUM|HIGH","reason":"สั้นๆ","ocr":{"amount":ตัวเลขหรือ null,"transferDatetime":"ISO 8601 หรือ null","bank":"...","senderName":"...","receiverName":"...","referenceNo":"...","rawText":"..."}}',
].join("\n");

function intentForKind(kind: LineImageKind): LineIntent {
  if (kind === "payment_slip") return LineIntent.PAYMENT_SLIP_IMAGE;
  if (kind === "part_image") return LineIntent.PART_IMAGE_INQUIRY;
  return LineIntent.UNKNOWN;
}

function normalizeKind(value: unknown): LineImageKind {
  if (value === "part_image" || value === "payment_slip" || value === "unknown_image") {
    return value;
  }
  return "unknown_image";
}

function normalizeConfidence(value: unknown): LineImageConfidence {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  return "LOW";
}

/**
 * True when a hint looks like a vehicle chassis / engine / VIN code rather than a
 * searchable term — so it can be kept out of the product-search query. A token is
 * chassis-like when it appears inside the dedicated `chassisNumber` field, or it's
 * a long alphanumeric block mixing letters and digits (e.g. TFS86HPM7B,
 * MR1TFS86HAT100061). Multi-word hints (e.g. "Isuzu D-Max") never match. Printed
 * part numbers (e.g. 422176-1870, all digits/dashes) are NOT filtered.
 */
function isChassisLikeToken(hint: string, chassisNumber: string | null): boolean {
  const token = hint.trim();
  if (!token) return true;
  const normalized = token.toLowerCase().replace(/\s+/g, "");
  if (chassisNumber) {
    const chassis = chassisNumber.toLowerCase().replace(/\s+/g, "");
    if (token.length >= 4 && (chassis.includes(normalized) || normalized.includes(chassis))) {
      return true;
    }
  }
  // Single long token mixing letters AND digits (no spaces) → VIN/chassis/engine.
  return /^(?=.*[a-z])(?=.*\d)[a-z0-9-]{7,}$/i.test(token);
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

export function parseLineImageClassification(raw: string): LineImageClassification {
  const jsonText = extractJson(raw);
  if (!jsonText) return UNKNOWN_FALLBACK;

  try {
    const parsed = JSON.parse(jsonText) as {
      kind?: unknown;
      searchHints?: unknown;
      confidence?: unknown;
      reason?: unknown;
      ocr?: unknown;
      partType?: unknown;
      carBrand?: unknown;
      carModel?: unknown;
      year?: unknown;
      partNumber?: unknown;
      chassisNumber?: unknown;
      partKind?: unknown;
    };
    const kind = normalizeKind(parsed.kind);

    const cleanStr = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return !trimmed || trimmed.toLowerCase() === "null" ? null : trimmed;
    };
    const cleanYear = (value: unknown): number | null => {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
      return Number.isInteger(n) && n >= 1950 && n <= 2100 ? n : null;
    };
    const partKindRaw = typeof parsed.partKind === "string" ? parsed.partKind.trim().toLowerCase() : "";
    const partKind: LineImagePartKind | null =
      kind === "part_image" && (partKindRaw === "fitment" || partKindRaw === "universal") ? partKindRaw : null;

    const partType = kind === "part_image" ? cleanStr(parsed.partType) : null;
    const carBrand = kind === "part_image" ? cleanStr(parsed.carBrand) : null;
    const carModel = kind === "part_image" ? cleanStr(parsed.carModel) : null;
    const year = kind === "part_image" ? cleanYear(parsed.year) : null;
    const partNumber = kind === "part_image" ? cleanStr(parsed.partNumber) : null;
    const chassisNumber = kind === "part_image" ? cleanStr(parsed.chassisNumber) : null;

    // Build CLEAN search hints. The catalog is indexed by part type + car
    // model/brand (+ printed part numbers), never by VIN/chassis/engine codes —
    // those would become required tokens and zero out every result. So compose
    // the searchable hints from the structured fields + printed part number +
    // any raw vision hint that is NOT a chassis-like code.
    const rawHints =
      kind === "part_image" && Array.isArray(parsed.searchHints)
        ? parsed.searchHints
            .filter((hint): hint is string => typeof hint === "string")
            .map((hint) => hint.trim())
            .filter(Boolean)
        : [];
    const seen = new Set<string>();
    const searchHints: string[] = [];
    for (const hint of [partType, carBrand, carModel, partNumber, ...rawHints]) {
      if (!hint) continue;
      if (isChassisLikeToken(hint, chassisNumber)) continue;
      const key = hint.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      searchHints.push(hint);
      if (searchHints.length >= 8) break;
    }

    // Slip OCR fields come back in the same response — reuse the slip parser so
    // there is no separate vision call for OCR.
    const ocr =
      kind === "payment_slip" && parsed.ocr && typeof parsed.ocr === "object"
        ? parsePaymentSlipOcr(JSON.stringify(parsed.ocr))
        : null;

    return {
      kind,
      intent: intentForKind(kind),
      searchHints,
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "GEMINI_VISION",
      partType,
      carBrand,
      carModel,
      year,
      partNumber,
      chassisNumber,
      partKind,
      ocr,
    };
  } catch {
    return UNKNOWN_FALLBACK;
  }
}

/**
 * Classifies an inbound LINE image (part vs payment slip vs unknown) using Gemini
 * Vision. The image is fetched from LINE on demand and never stored. Any failure
 * (missing keys/token, expired content, vision/parse error) degrades safely to an
 * "unknown" classification so the webhook pipeline is never broken by an image.
 */
export async function classifyLineImage(input: {
  channelAccessToken: string | null;
  lineMessageId: string | null;
}): Promise<LineImageClassification> {
  if (!input.channelAccessToken || !input.lineMessageId || !hasGeminiKeysConfigured()) {
    return { ...UNKNOWN_FALLBACK, reason: "MISSING_TOKEN_OR_KEYS" };
  }

  try {
    const content = await fetchLineMessageContent({
      channelAccessToken: input.channelAccessToken,
      messageId: input.lineMessageId,
    });

    if (!content || !content.mimeType.startsWith("image/")) {
      return { ...UNKNOWN_FALLBACK, reason: "NO_IMAGE_CONTENT" };
    }

    const { text } = await generateGeminiContent({
      prompt: CLASSIFY_PROMPT,
      images: [{ mimeType: content.mimeType, dataBase64: content.dataBase64 }],
      json: true,
      // Higher cap: a slip response now also carries OCR fields in the same call.
      maxOutputTokens: 600,
      temperature: 0,
      // Extraction task — disable thinking so the JSON isn't truncated.
      thinkingLevel: "NONE",
      // Bound the wait + key failover so a hung key can't blow the webhook budget.
      timeoutMs: VISION_CALL_TIMEOUT_MS,
      maxKeyAttempts: VISION_MAX_KEY_ATTEMPTS,
    });

    return {
      ...parseLineImageClassification(text),
      content,
    };
  } catch {
    return { ...UNKNOWN_FALLBACK, reason: "IMAGE_CLASSIFICATION_ERROR" };
  }
}
