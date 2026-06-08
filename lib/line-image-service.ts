import { LineIntent } from "@/lib/generated/prisma";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { fetchLineMessageContent, type LineMessageContent } from "@/lib/line-messaging";

export type LineImageKind = "part_image" | "payment_slip" | "unknown_image";
export type LineImageConfidence = "LOW" | "MEDIUM" | "HIGH";

export type LineImageClassification = {
  kind: LineImageKind;
  intent: LineIntent;
  /** Free-text hints (brand/model/part-number clues) for part images. Empty for slips. */
  searchHints: string[];
  confidence: LineImageConfidence;
  reason: string;
  content?: LineMessageContent;
};

const UNKNOWN_FALLBACK: LineImageClassification = {
  kind: "unknown_image",
  intent: LineIntent.UNKNOWN,
  searchHints: [],
  confidence: "LOW",
  reason: "IMAGE_CLASSIFICATION_UNAVAILABLE",
};

const CLASSIFY_PROMPT = [
  "คุณเป็นผู้ช่วยจำแนกรูปภาพที่ลูกค้าส่งเข้ามาในแชทร้านอะไหล่แอร์รถยนต์",
  "จำแนกรูปนี้เป็นหนึ่งใน 3 ประเภท:",
  '- "part_image": รูปชิ้นส่วน/อะไหล่ เช่น คอมแอร์ แผงแอร์ คอยล์ ตัวอะไหล่ หรือเบอร์บนอะไหล่',
  '- "payment_slip": สลิป/หลักฐานการโอนเงิน/การชำระเงินจากธนาคารหรือแอปธนาคาร',
  '- "unknown_image": รูปอื่นที่ไม่เข้าสองประเภทข้างต้น',
  "ถ้าเป็น part_image ให้ดึงคำใบ้สำหรับค้นหา (ยี่ห้อ รุ่นรถ เบอร์อะไหล่ ข้อความบนชิ้นส่วน) ใส่ใน searchHints",
  "ถ้าเป็น payment_slip ห้ามใส่ searchHints ใด ๆ (ต้องเป็น array ว่าง)",
  "ตอบเป็น JSON ล้วนเท่านั้น ห้ามมี markdown:",
  '{"kind":"part_image|payment_slip|unknown_image","searchHints":["..."],"confidence":"LOW|MEDIUM|HIGH","reason":"สั้นๆ"}',
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
    };
    const kind = normalizeKind(parsed.kind);
    const searchHints =
      kind === "part_image" && Array.isArray(parsed.searchHints)
        ? parsed.searchHints
            .filter((hint): hint is string => typeof hint === "string")
            .map((hint) => hint.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];

    return {
      kind,
      intent: intentForKind(kind),
      searchHints,
      confidence: normalizeConfidence(parsed.confidence),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "GEMINI_VISION",
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
      maxOutputTokens: 300,
      temperature: 0,
    });

    return {
      ...parseLineImageClassification(text),
      content,
    };
  } catch {
    return { ...UNKNOWN_FALLBACK, reason: "IMAGE_CLASSIFICATION_ERROR" };
  }
}
