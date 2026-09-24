import { del } from "@vercel/blob";
import sharp from "sharp";

import {
  EXPENSE_ATTACHMENT_PDF_MIME_TYPE,
  EXPENSE_ATTACHMENT_ROOT,
} from "@/lib/expense-attachment-constants";
import { sniffImageMimeType } from "@/lib/image-upload-validation";
import { deletePrivateBlobObjects, putPrivateBlobObject } from "@/lib/private-blob-storage";
import { isLegacyPublicFileUrl, isPrivateObjectPathUnderRoot } from "@/lib/private-file-ref";

/**
 * Storage for expense evidence files (transfer slips / receipts). Images are
 * normalised the same way LINE payment slips are — EXIF-rotated, grayscale,
 * downscaled and re-encoded as WebP — so a phone photo lands at ~20–50KB and
 * stays readable. PDFs are stored byte-for-byte: `sharp` cannot decode PDF and
 * rasterising it would both bloat the bundle and weaken the evidence.
 *
 * Attachments are PII, so new files go to the PRIVATE Blob store and the DB keeps
 * the object pathname; they are viewed through the session-checked
 * `/api/admin/expense-attachments/[id]` route. Rows created before that change
 * still hold a public Blob URL and keep working (see `lib/private-file-ref.ts`).
 */

const IMAGE_MAX_DIMENSION = 1000; // px — enough to read amounts/reference numbers.
const IMAGE_WEBP_QUALITY = 60;
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export interface PreparedExpenseAttachment {
  body: Uint8Array;
  contentType: string;
  extension: string;
}

const isPdfBuffer = (bytes: Uint8Array): boolean =>
  bytes.length >= PDF_MAGIC_BYTES.length && PDF_MAGIC_BYTES.every((byte, i) => bytes[i] === byte);

/**
 * Validates the real file type from magic bytes (never the client-supplied MIME)
 * and returns the bytes to store. Returns null when the file is neither a
 * supported image nor a PDF.
 */
export async function prepareExpenseAttachment(
  bytes: Uint8Array,
): Promise<PreparedExpenseAttachment | null> {
  if (isPdfBuffer(bytes)) {
    return { body: bytes, contentType: EXPENSE_ATTACHMENT_PDF_MIME_TYPE, extension: "pdf" };
  }

  if (!sniffImageMimeType(bytes)) return null;

  const webp = await sharp(Buffer.from(bytes))
    .rotate() // honor EXIF orientation
    .grayscale()
    .resize({
      width: IMAGE_MAX_DIMENSION,
      height: IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_WEBP_QUALITY })
    .toBuffer();

  return { body: new Uint8Array(webp), contentType: "image/webp", extension: "webp" };
}

/** Object path for one attachment — content-addressed so it can never collide. */
export function buildExpenseAttachmentObjectPath(expenseId: string, extension: string): string {
  const safeExpenseId = expenseId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${EXPENSE_ATTACHMENT_ROOT}/${safeExpenseId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

/**
 * Uploads a prepared attachment to the private store and returns its pathname.
 * Throws when the private store is not configured — never falls back to public.
 */
export async function uploadExpenseAttachmentObject(input: {
  expenseId: string;
  prepared: PreparedExpenseAttachment;
}): Promise<string> {
  return putPrivateBlobObject({
    objectPath: buildExpenseAttachmentObjectPath(input.expenseId, input.prepared.extension),
    body: input.prepared.body,
    contentType: input.prepared.contentType,
  });
}

/** True for a new-style private-store pathname under `expense-attachments/`. */
export function isPrivateExpenseAttachmentPath(value: string): boolean {
  return isPrivateObjectPathUnderRoot(value, EXPENSE_ATTACHMENT_ROOT);
}

/**
 * True only for *our* legacy expense-attachment objects — the public Blob host
 * plus the `expense-attachments/` object root. Gates deletion so an arbitrary
 * Blob URL can never be removed through here.
 */
export function isOwnedExpenseAttachmentUrl(url: string): boolean {
  if (!isLegacyPublicFileUrl(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!parsed.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    objectPath = parsed.pathname.replace(/^\/+/, "");
  }
  return objectPath.startsWith(`${EXPENSE_ATTACHMENT_ROOT}/`);
}

/**
 * Best-effort removal of stored attachment objects — never throws. Each stored
 * value is removed from the store it lives in: private pathnames from the
 * private store, legacy public URLs from the public store.
 */
export async function deleteExpenseAttachmentObjects(urls: string[]): Promise<void> {
  const privatePaths = urls.filter(isPrivateExpenseAttachmentPath);
  if (privatePaths.length > 0) await deletePrivateBlobObjects(privatePaths);

  const ownedUrls = urls.filter(isOwnedExpenseAttachmentUrl);
  if (ownedUrls.length === 0) return;
  try {
    await del(ownedUrls);
  } catch (error) {
    console.error("[expense-attachment-storage] blob delete failed", error);
  }
}
