import { z } from "zod";

const lineAdminReplyBodySchema = z.object({
  text: z.string().trim().min(1, "EMPTY_MESSAGE").max(2000, "MESSAGE_TOO_LONG"),
});

const MAX_LINE_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — re-encoded to JPEG before sending.
const MAX_LINE_CAPTION_LENGTH = 2000;

/**
 * Detects the real image type from magic bytes, ignoring the spoofable
 * client-declared MIME/extension. Returns null when the signature does not match
 * a supported raster format (JPEG, PNG, WebP — all re-encoded to JPEG for LINE).
 */
function sniffImageMimeType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type LineAdminImageReply = {
  text: string | null;
  image: { buffer: Buffer };
};

/**
 * Validates a multipart admin reply that carries an image (with optional text
 * caption). Verifies size and real image type via magic bytes. Throws an Error
 * whose message is a stable error code on any failure.
 */
export async function parseLineAdminImageReply(formData: FormData): Promise<LineAdminImageReply> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("EMPTY_IMAGE");
  }
  if (file.size > MAX_LINE_IMAGE_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffImageMimeType(new Uint8Array(buffer))) {
    throw new Error("UNSUPPORTED_IMAGE_TYPE");
  }

  const rawText = formData.get("text");
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (text.length > MAX_LINE_CAPTION_LENGTH) {
    throw new Error("MESSAGE_TOO_LONG");
  }

  return { text: text || null, image: { buffer } };
}

const lineConversationReasonBodySchema = z.object({
  reason: z.string().trim().max(500, "REASON_TOO_LONG").optional().nullable(),
});

const paymentSlipReviewBodySchema = z.object({
  decision: z.enum(["confirm", "reject", "needs_info"], {
    error: "INVALID_DECISION",
  }),
});

function parseWithError<T>(schema: z.ZodType<T>, body: unknown, fallbackError: string): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const issueMessage = result.error.issues[0]?.message;
  throw new Error(issueMessage || fallbackError);
}

export function parseLineAdminReplyBody(body: unknown) {
  return parseWithError(lineAdminReplyBodySchema, body, "INVALID_REPLY_PAYLOAD");
}

export function parseLineConversationReasonBody(body: unknown) {
  const parsed = parseWithError(lineConversationReasonBodySchema, body, "INVALID_REASON_PAYLOAD");
  return {
    reason: parsed.reason?.trim() || null,
  };
}

export function parsePaymentSlipReviewBody(body: unknown) {
  return parseWithError(paymentSlipReviewBodySchema, body, "INVALID_DECISION");
}
