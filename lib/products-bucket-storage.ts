import { put } from "@vercel/blob";
import { isBlobBackend } from "@/lib/storage-backend";
import {
  PRODUCT_IMAGE_BUCKET,
  createProductImageStorageClient,
  getProductImageStorageConfig,
  getPublicProductImageUrl,
} from "@/lib/product-image-storage";

/**
 * Write-side facade for the public `products` Supabase bucket during the
 * Supabase Storage → Vercel Blob migration.
 *
 * The `products` bucket holds several public object roots — product images
 * (`products/<code>/…`), shop settings (`settings/…`), user signatures
 * (`users/signatures/…`), and delivery proofs (`delivery-proofs/…`). All of them
 * share one rollout flag (`IMAGE_STORAGE_PRODUCTS`) so they flip together.
 *
 * Phase 1 scope is dual-write only: new uploads go to the selected backend and
 * return a public URL. Existing render-time helpers (`toProductImageCdnPath` /
 * `toPublicStorageCdnPath`) already pass Blob URLs through untouched, and
 * `next.config.ts` allows the Blob host, so no read-side change is needed.
 */

const PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS = 31_536_000; // 1 year — content-addressed paths.

export interface PublicObjectUploadInput {
  /** Object path inside the bucket, e.g. `products/<code>/<file>.webp`. Already unique. */
  objectPath: string;
  body: Uint8Array;
  contentType: string;
}

/**
 * Uploads an object to the active `products`-bucket backend and returns its
 * public URL. Throws on misconfiguration or upload failure so the caller can
 * surface a friendly message (every current call site already wraps this in
 * try/catch).
 */
export async function uploadProductsBucketObject(input: PublicObjectUploadInput): Promise<string> {
  if (isBlobBackend("products")) {
    const result = await put(input.objectPath, Buffer.from(input.body), {
      access: "public",
      contentType: input.contentType,
      // Paths are content-addressed (timestamp + uuid) so they never collide —
      // keep the exact path instead of letting Blob append a random suffix.
      addRandomSuffix: false,
      cacheControlMaxAge: PUBLIC_BLOB_CACHE_MAX_AGE_SECONDS,
    });
    return result.url;
  }

  const config = getProductImageStorageConfig();
  if (!config) {
    throw new Error("PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED");
  }
  const client = createProductImageStorageClient(config);
  const { error } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(input.objectPath, input.body, { contentType: input.contentType, upsert: false });
  if (error) {
    throw new Error(`PRODUCT_IMAGE_UPLOAD_FAILED:${error.message}`);
  }
  return getPublicProductImageUrl(client, input.objectPath);
}
