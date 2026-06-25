import sharp from "sharp";
import { put } from "@vercel/blob";

/**
 * Public storage for outbound admin chat images sent through LINE OA (Vercel Blob).
 *
 * These images MUST be publicly reachable over HTTPS: the LINE platform fetches
 * `originalContentUrl` / `previewImageUrl` server-side when delivering an image
 * message, so they live in the public Blob store.
 *
 * LINE image-message constraints we satisfy here:
 *  - format: JPEG or PNG only  → we always re-encode to JPEG via sharp
 *  - originalContentUrl: ≤ 10MB, ≤ 4096×4096
 *  - previewImageUrl: ≤ 1MB  → we ship a small downscaled preview
 */

const ORIGINAL_MAX_DIMENSION = 2048; // px — well under LINE's 4096 cap.
const ORIGINAL_QUALITY = 85;
const PREVIEW_MAX_DIMENSION = 640; // px — keeps preview comfortably under 1MB.
const PREVIEW_QUALITY = 70;

export type LineChatImageUploadResult = {
  /** Stored on LineMessage.imageUrl and rendered in the admin chat. */
  originalUrl: string;
  /** Small thumbnail used for LINE's previewImageUrl. */
  previewUrl: string;
  /** Object path of the original (full-size) image inside the bucket. */
  originalPath: string;
};

/** Path layout: line-chat/YYYY/MM/DD/<uuid>.jpg (+ <uuid>-preview.jpg) */
function buildObjectPaths(date: Date): { originalPath: string; previewPath: string } {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const id = crypto.randomUUID();
  const folder = `${yyyy}/${mm}/${dd}`;
  return {
    originalPath: `${folder}/${id}.jpg`,
    previewPath: `${folder}/${id}-preview.jpg`,
  };
}

/**
 * Re-encodes an admin-supplied image to a LINE-compatible JPEG (full size +
 * preview) and uploads both to the public Blob store. Throws on upload failure so
 * the caller can surface a friendly error and abort the send.
 */
export async function storeLineChatImage(input: { buffer: Buffer; date?: Date }): Promise<LineChatImageUploadResult> {
  const [original, preview] = await Promise.all([
    sharp(input.buffer)
      .rotate() // honor EXIF orientation
      .resize({ width: ORIGINAL_MAX_DIMENSION, height: ORIGINAL_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: ORIGINAL_QUALITY })
      .toBuffer(),
    sharp(input.buffer)
      .rotate()
      .resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: PREVIEW_QUALITY })
      .toBuffer(),
  ]);

  const { originalPath, previewPath } = buildObjectPaths(input.date ?? new Date());

  const [originalUpload, previewUpload] = await Promise.all([
    put(originalPath, original, { access: "public", contentType: "image/jpeg", addRandomSuffix: false }),
    put(previewPath, preview, { access: "public", contentType: "image/jpeg", addRandomSuffix: false }),
  ]);

  return {
    originalUrl: originalUpload.url,
    previewUrl: previewUpload.url,
    originalPath,
  };
}
