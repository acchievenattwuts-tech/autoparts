import { copy, del, put } from "@vercel/blob";
import {
  PRODUCT_IMAGE_ROOT,
  buildProductImageObjectPath,
  isProductImageObjectPathForCode,
} from "@/lib/product-image-url";

/**
 * Write-side storage for the public product images (and shop logo, signatures,
 * delivery proofs) — now Vercel Blob only. Supabase Storage has been fully
 * migrated away for these objects; the only remaining Supabase Storage user is
 * the temporary purchase-OCR bucket.
 *
 * Read-side helpers (`toProductImageCdnPath` / `toPublicStorageCdnPath`) pass Blob
 * URLs through untouched and `next.config.ts` allows the Blob host.
 */

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS = 31_536_000; // 1 year — content-addressed paths.

export interface PublicObjectUploadInput {
  /** Object path inside the bucket, e.g. `products/<code>/<file>.webp`. Already unique. */
  objectPath: string;
  body: Uint8Array;
  contentType: string;
}

/** Uploads an object to the public Blob store and returns its public URL. */
export async function uploadProductsBucketObject(input: PublicObjectUploadInput): Promise<string> {
  const result = await put(input.objectPath, Buffer.from(input.body), {
    access: "public",
    contentType: input.contentType,
    // Paths are content-addressed (timestamp + uuid) so they never collide.
    addRandomSuffix: false,
    cacheControlMaxAge: PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS,
  });
  return result.url;
}

/** The products-bucket object path for one of our Blob URLs (else null). */
export function getBlobProductObjectPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith(BLOB_HOST_SUFFIX)) return null;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    objectPath = parsed.pathname.replace(/^\/+/, "");
  }
  return objectPath.startsWith(`${PRODUCT_IMAGE_ROOT}/`) ? objectPath : null;
}

/**
 * True only for *our* product-image objects stored in Vercel Blob — the public
 * Blob host plus the `products/` object root. Used to gate deletion so an
 * arbitrary Blob URL can never be removed through here.
 */
export function isOwnedBlobProductUrl(url: string): boolean {
  return getBlobProductObjectPath(url) !== null;
}

/** True if a Blob product image URL already lives under the given product's code folder. */
export function isBlobProductUrlInCodeFolder(url: string, productCode: string): boolean {
  const objectPath = getBlobProductObjectPath(url);
  return !!objectPath && isProductImageObjectPathForCode(objectPath, productCode);
}

export type ProductImageCopyResult =
  | { success: true; url: string; copied: boolean }
  | { success: false; error: string };

/**
 * Copies a Blob product image into the product's `products/<code>/` folder so each
 * product owns its images. No-op when the image is already in the code folder or
 * is not one of our Blob product objects.
 */
export async function copyBlobProductImageToCodeFolder(input: {
  url: string;
  productCode: string;
  extension?: string;
}): Promise<ProductImageCopyResult> {
  const objectPath = getBlobProductObjectPath(input.url);
  if (!objectPath || isProductImageObjectPathForCode(objectPath, input.productCode)) {
    return { success: true, url: input.url, copied: false };
  }

  const ext = objectPath.split(".").pop() ?? input.extension ?? "jpg";
  const destinationPath = buildProductImageObjectPath(input.productCode, ext);
  try {
    const result = await copy(input.url, destinationPath, {
      access: "public",
      addRandomSuffix: false,
      cacheControlMaxAge: PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS,
    });
    return { success: true, url: result.url, copied: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "copy failed" };
  }
}

/**
 * Deletes product-image objects from the public Blob store. Only removes objects
 * the caller owns (gated by {@link isOwnedBlobProductUrl}); callers already guard
 * against removing still-referenced URLs. Best-effort — never throws.
 */
export async function deleteProductsBucketObjects(urls: string[]): Promise<void> {
  const blobUrls = urls.filter(isOwnedBlobProductUrl);
  if (blobUrls.length === 0) return;
  try {
    await del(blobUrls);
  } catch (error) {
    console.error("[products-bucket-storage] blob delete failed", error);
  }
}
