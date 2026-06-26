/**
 * Pure URL helpers for product images.
 *
 * This module must stay free of any external dependency (no `@supabase/supabase-js`,
 * no Node-only APIs) so it can be safely imported into Client Components without
 * bloating the browser bundle. Storage-side helpers that need the Supabase client
 * live in `lib/product-image-storage.ts`, which re-exports everything here.
 */

export const PRODUCT_IMAGE_BUCKET = "products";
export const PRODUCT_IMAGE_ROOT = "products";
export const LINE_CHAT_IMAGE_BUCKET = "line-chat";

/**
 * Legacy same-origin image-proxy prefix. No longer used now that images are
 * served directly from Vercel Blob; retained only for backward-compatible exports.
 *
 * @deprecated The `/img` proxy route was removed.
 */
export const PRODUCT_IMAGE_CDN_PREFIX = "/img";

export type PublicStorageCdnBucket = typeof PRODUCT_IMAGE_BUCKET | typeof LINE_CHAT_IMAGE_BUCKET;

export type PublicStorageCdnTarget = {
  bucket: PublicStorageCdnBucket;
  objectPath: string;
};

const PRODUCT_BUCKET_PUBLIC_ROOTS = [
  `${PRODUCT_IMAGE_ROOT}/`,
  "settings/",
  "users/signatures/",
  "delivery-proofs/",
] as const;

export function sanitizeProductImageCode(code: string): string {
  const normalized = code.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "uncoded";
}

export function getProductImageFolder(productCode: string): string {
  return `${PRODUCT_IMAGE_ROOT}/${sanitizeProductImageCode(productCode)}`;
}

export function buildProductImageObjectPath(productCode: string, extension: string): string {
  const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${getProductImageFolder(productCode)}/${Date.now()}-${crypto.randomUUID()}.${safeExt}`;
}

export function buildPublicProductImageUrl(supabaseUrl: string, objectPath: string): string {
  const baseUrl = supabaseUrl.replace(/\/+$/g, "");
  return `${baseUrl}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${encodeURI(objectPath)}`;
}

export function buildSupabasePublicStorageUrl(
  supabaseUrl: string,
  target: PublicStorageCdnTarget,
): string {
  const baseUrl = supabaseUrl.replace(/\/+$/g, "");
  return `${baseUrl}/storage/v1/object/public/${target.bucket}/${encodeURI(target.objectPath)}`;
}

export function getProductImageObjectPathFromPublicUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
  if (!encodedPath) {
    return null;
  }

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

export function isProductImageObjectPath(objectPath: string): boolean {
  return objectPath.startsWith(`${PRODUCT_IMAGE_ROOT}/`);
}

function hasUnsafePathSegment(objectPath: string): boolean {
  return objectPath
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function isAllowedProductsBucketPublicPath(objectPath: string): boolean {
  return PRODUCT_BUCKET_PUBLIC_ROOTS.some((root) => objectPath.startsWith(root));
}

export function resolvePublicStorageCdnTarget(routePath: string): PublicStorageCdnTarget | null {
  if (!routePath || hasUnsafePathSegment(routePath)) return null;

  if (routePath.startsWith(`${LINE_CHAT_IMAGE_BUCKET}/`)) {
    const objectPath = routePath.slice(`${LINE_CHAT_IMAGE_BUCKET}/`.length);
    if (!objectPath || hasUnsafePathSegment(objectPath)) return null;
    return { bucket: LINE_CHAT_IMAGE_BUCKET, objectPath };
  }

  if (isAllowedProductsBucketPublicPath(routePath)) {
    return { bucket: PRODUCT_IMAGE_BUCKET, objectPath: routePath };
  }

  return null;
}

export function isProductImageObjectPathForCode(objectPath: string, productCode: string): boolean {
  return objectPath.startsWith(`${getProductImageFolder(productCode)}/`);
}

/**
 * Identity pass-through. Images are now served directly from their stored
 * (Vercel Blob) URL, so no rewrite is needed. Kept so the many render call sites
 * stay unchanged; returns the URL as-is (null for empty input).
 *
 * @deprecated Render the stored URL directly; this no longer transforms anything.
 */
export function toProductImageCdnPath(url: string | null | undefined): string | null {
  return url ?? null;
}

/**
 * Identity pass-through. See {@link toProductImageCdnPath}.
 *
 * @deprecated Render the stored URL directly; this no longer transforms anything.
 */
export function toPublicStorageCdnPath(url: string | null | undefined): string | null {
  return url ?? null;
}
