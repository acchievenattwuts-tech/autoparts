import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Public storage for outbound admin chat images sent through LINE OA.
 *
 * Unlike payment slips (private + signed URLs), these images MUST live in a
 * PUBLIC bucket: the LINE platform fetches `originalContentUrl` / `previewImageUrl`
 * server-side when delivering an image message, so the URLs have to be openly
 * reachable over HTTPS.
 *
 * LINE image-message constraints we satisfy here:
 *  - format: JPEG or PNG only  → we always re-encode to JPEG via sharp
 *  - originalContentUrl: ≤ 10MB, ≤ 4096×4096
 *  - previewImageUrl: ≤ 1MB  → we ship a small downscaled preview
 */

const BUCKET = "line-chat";
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

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

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

let bucketEnsured = false;
async function ensureBucket(client: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  // Idempotent: ignore "already exists". Public so LINE can fetch the image.
  const { error } = await client.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`CREATE_BUCKET_FAILED:${error.message}`);
  }
  bucketEnsured = true;
}

function publicUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Re-encodes an admin-supplied image to a LINE-compatible JPEG (full size +
 * preview) and uploads both to the public bucket. Throws on misconfiguration or
 * upload failure so the caller can surface a friendly error and abort the send.
 */
export async function storeLineChatImage(input: { buffer: Buffer; date?: Date }): Promise<LineChatImageUploadResult> {
  const client = getServiceClient();
  if (!client) {
    throw new Error("LINE_CHAT_IMAGE_STORAGE_NOT_CONFIGURED");
  }

  await ensureBucket(client);

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
    client.storage.from(BUCKET).upload(originalPath, original, { contentType: "image/jpeg", upsert: false }),
    client.storage.from(BUCKET).upload(previewPath, preview, { contentType: "image/jpeg", upsert: false }),
  ]);

  if (originalUpload.error || previewUpload.error) {
    throw new Error(
      `LINE_CHAT_IMAGE_UPLOAD_FAILED:${originalUpload.error?.message ?? previewUpload.error?.message ?? "unknown"}`,
    );
  }

  return {
    originalUrl: publicUrl(client, originalPath),
    previewUrl: publicUrl(client, previewPath),
    originalPath,
  };
}
