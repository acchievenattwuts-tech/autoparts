import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCT_IMAGE_BUCKET,
  buildProductImageObjectPath,
  getProductImageObjectPathFromPublicUrl,
  isProductImageObjectPath,
  isProductImageObjectPathForCode,
} from "@/lib/product-image-url";

// Re-export the pure URL helpers so existing server-side importers of this module
// keep their current API. New client-safe code should import from
// `@/lib/product-image-url` directly (it has no `@supabase/supabase-js` dependency).
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

type ProductImageStorageClient = SupabaseClient;

export type ProductImageStorageConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type ProductImageCopyResult =
  | { success: true; url: string; objectPath: string; copied: boolean }
  | { success: false; error: string };

export function getProductImageStorageConfig(): ProductImageStorageConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return { supabaseUrl, serviceRoleKey };
}

export function createProductImageStorageClient(config: ProductImageStorageConfig): ProductImageStorageClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey);
}

export function getPublicProductImageUrl(client: ProductImageStorageClient, objectPath: string): string {
  const {
    data: { publicUrl },
  } = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(objectPath);

  return publicUrl;
}

/**
 * Returns true only when the URL points to an object inside *our* configured
 * Supabase project's product-image bucket. Used to reject arbitrary external
 * URLs from being stored on Product.imageUrl / ProductImage.url.
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

/**
 * Best-effort deletion of storage objects from a list of public URLs.
 * Silently ignores URLs that are not product-image object paths in our bucket.
 */
export async function deleteProductImageObjects(
  client: ProductImageStorageClient,
  urls: string[],
): Promise<void> {
  const paths = urls
    .map((url) => getProductImageObjectPathFromPublicUrl(url))
    .filter((path): path is string => !!path && isProductImageObjectPath(path));

  if (paths.length === 0) return;

  await client.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
}

export async function copyProductImageUrlToCodeFolder({
  client,
  url,
  productCode,
  extension,
}: {
  client: ProductImageStorageClient;
  url: string;
  productCode: string;
  extension?: string;
}): Promise<ProductImageCopyResult> {
  const sourcePath = getProductImageObjectPathFromPublicUrl(url);
  if (!sourcePath || !isProductImageObjectPath(sourcePath)) {
    return { success: true, url, objectPath: sourcePath ?? "", copied: false };
  }

  if (isProductImageObjectPathForCode(sourcePath, productCode)) {
    return { success: true, url, objectPath: sourcePath, copied: false };
  }

  const sourceExt = sourcePath.split(".").pop() ?? extension ?? "jpg";
  const destinationPath = buildProductImageObjectPath(productCode, sourceExt);
  const { error } = await client.storage.from(PRODUCT_IMAGE_BUCKET).copy(sourcePath, destinationPath);

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    url: getPublicProductImageUrl(client, destinationPath),
    objectPath: destinationPath,
    copied: true,
  };
}
