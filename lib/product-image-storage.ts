import {
  getProductImageObjectPathFromPublicUrl,
  isProductImageObjectPath,
} from "@/lib/product-image-url";

// Re-export the pure URL helpers so existing server-side importers of this module
// keep their current API. New client-safe code should import from
// `@/lib/product-image-url` directly.
export {
  PRODUCT_IMAGE_BUCKET,
  LINE_CHAT_IMAGE_BUCKET,
  PRODUCT_IMAGE_ROOT,
  PRODUCT_IMAGE_CDN_PREFIX,
  type PublicStorageCdnBucket,
  type PublicStorageCdnTarget,
  sanitizeProductImageCode,
  getProductImageFolder,
  buildProductImageObjectPath,
  buildPublicProductImageUrl,
  buildSupabasePublicStorageUrl,
  getProductImageObjectPathFromPublicUrl,
  isProductImageObjectPath,
  isProductImageObjectPathForCode,
  resolvePublicStorageCdnTarget,
  toPublicStorageCdnPath,
  toProductImageCdnPath,
} from "@/lib/product-image-url";

/**
 * Returns true only when the URL points to an object inside our configured
 * Supabase project's product-image bucket. Retained to validate legacy Supabase
 * URLs; current Blob URLs are validated by `isOwnedBlobProductUrl`.
 */
export function isAllowedProductImageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }

  if (parsed.host !== base.host) return false;

  const objectPath = getProductImageObjectPathFromPublicUrl(url);
  return !!objectPath && isProductImageObjectPath(objectPath);
}
