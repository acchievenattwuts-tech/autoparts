import { copy, del, put } from "@vercel/blob";
import {
  CATEGORY_IMAGE_ROOT,
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

/** The object path of one of our Blob URLs under `root/` (else null). */
function getBlobObjectPathUnderRoot(url: string, root: string): string | null {
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
  return objectPath.startsWith(`${root}/`) ? objectPath : null;
}

/** The products-bucket object path for one of our Blob URLs (else null). */
export function getBlobProductObjectPath(url: string): string | null {
  return getBlobObjectPathUnderRoot(url, PRODUCT_IMAGE_ROOT);
}

/**
 * True only for *our* product-image objects stored in Vercel Blob — the public
 * Blob host plus the `products/` object root. Used to gate deletion so an
 * arbitrary Blob URL can never be removed through here.
 */
export function isOwnedBlobProductUrl(url: string): boolean {
  return getBlobProductObjectPath(url) !== null;
}

/**
 * True only for *our* category-thumbnail objects — the public Blob host plus the
 * `settings/categories/` object root. Used to validate what an admin form may
 * store in `Category.imageUrl`: `next.config.ts` only allows next/image to load
 * the Blob host, so any other URL would render as a broken tile on the
 * storefront rather than an image.
 */
export function isOwnedBlobCategoryImageUrl(url: string): boolean {
  return getBlobObjectPathUnderRoot(url, CATEGORY_IMAGE_ROOT) !== null;
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

/**
 * Deletes category-thumbnail objects. Gated to the `settings/categories/` root on
 * our own Blob host, so neither a product image nor an arbitrary URL can be removed
 * through here. Best-effort — never throws, since losing a replaced file is not a
 * reason to fail the admin's save.
 */
export async function deleteCategoryImageObjects(urls: string[]): Promise<void> {
  const blobUrls = urls.filter((url) => getBlobObjectPathUnderRoot(url, CATEGORY_IMAGE_ROOT) !== null);
  if (blobUrls.length === 0) return;
  try {
    await del(blobUrls);
  } catch (error) {
    console.error("[products-bucket-storage] category image delete failed", error);
  }
}
