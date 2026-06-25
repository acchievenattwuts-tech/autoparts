import sharp from "sharp";
import { del, get, put } from "@vercel/blob";

import type { LineMessageContent } from "@/lib/line-messaging";

/**
 * Private storage for payment-slip images (PII: bank/account/name). Slips live in
 * a separate PRIVATE Vercel Blob store and are only viewable by authenticated
 * admins through the session-checked `/api/admin/line-payment-slips/[id]/image`
 * route. Images are compressed hard (grayscale WebP, downscaled) — ~20–50KB each.
 */

const MAX_DIMENSION = 1000; // px — enough to read amounts/reference numbers.
const WEBP_QUALITY = 60;

/** Token for the separate PRIVATE Blob store that holds PII slips. */
const slipBlobToken = (): string | undefined => process.env.BLOB_SLIPS_READ_WRITE_TOKEN;

/** Path layout: payment-slips/YYYY/MM/DD/<slipId>.webp */
export function buildPaymentSlipObjectPath(slipId: string, date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${slipId}.webp`;
}

/** Compresses an inbound image to a small grayscale WebP buffer. */
export async function compressSlipImage(content: LineMessageContent): Promise<Buffer> {
  const input = Buffer.from(content.dataBase64, "base64");
  return sharp(input)
    .rotate() // honor EXIF orientation
    .grayscale()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * Compresses + uploads a slip image to the private Blob store. Returns the stored
 * object path (saved in PaymentSlip.imageUrl) or null on failure. Never throws —
 * image persistence is best-effort.
 */
export async function storePaymentSlipImage(input: {
  slipId: string;
  date: Date;
  content: LineMessageContent;
}): Promise<string | null> {
  try {
    const webp = await compressSlipImage(input.content);
    const path = buildPaymentSlipObjectPath(input.slipId, input.date);

    await put(path, webp, {
      access: "private",
      contentType: "image/webp",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: slipBlobToken(),
    });
    return path;
  } catch (error) {
    console.error("[payment-slip-storage] store failed", error);
    return null;
  }
}

/** Deletes a stored slip image (used when an admin rejects a slip). Best-effort. */
export async function deletePaymentSlipImage(path: string): Promise<void> {
  try {
    await del(path, { token: slipBlobToken() });
  } catch (error) {
    console.error("[payment-slip-storage] delete failed", error);
  }
}

/** Same-origin admin route that streams a slip image (session-checked). */
export function buildPaymentSlipImageRoute(slipId: string): string {
  return `/api/admin/line-payment-slips/${slipId}/image`;
}

/**
 * Reads a slip image from the private Blob store for the stream route. Returns
 * null when the object is missing.
 */
export async function readPaymentSlipImage(
  path: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
  try {
    const result = await get(path, { access: "private", token: slipBlobToken() });
    if (result && result.statusCode === 200) {
      return { stream: result.stream, contentType: result.headers.get("content-type") ?? "image/webp" };
    }
  } catch (error) {
    console.error("[payment-slip-storage] blob read failed", error);
  }
  return null;
}
