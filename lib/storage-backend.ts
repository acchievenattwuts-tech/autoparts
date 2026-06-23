/**
 * Storage backend selector for the Supabase Storage → Vercel Blob migration.
 *
 * Each managed bucket can be flipped independently via env so the rollout can go
 * one bucket at a time (public product/line-chat first, private payment-slips
 * later) with an instant rollback by unsetting the flag.
 *
 * Default is "supabase" for every bucket — absence of any flag preserves the
 * existing behavior exactly. This module only *reports* the selected backend;
 * the actual read/write implementations are wired in their own storage modules
 * in later phases.
 */

export type StorageBackend = "supabase" | "blob";

/** Buckets in scope for the Blob migration (purchase-ocr is intentionally excluded). */
export type ManagedBucket = "products" | "line-chat" | "payment-slips";

const ENV_KEY_BY_BUCKET: Record<ManagedBucket, string> = {
  products: "IMAGE_STORAGE_PRODUCTS",
  "line-chat": "IMAGE_STORAGE_LINE_CHAT",
  "payment-slips": "IMAGE_STORAGE_PAYMENT_SLIPS",
};

/**
 * Returns the active storage backend for a bucket. Only the exact value "blob"
 * (case-insensitive) selects Vercel Blob; anything else — including unset — keeps
 * the existing Supabase backend.
 */
export function getStorageBackend(bucket: ManagedBucket): StorageBackend {
  const raw = process.env[ENV_KEY_BY_BUCKET[bucket]]?.trim().toLowerCase();
  return raw === "blob" ? "blob" : "supabase";
}

/** Convenience guard for call sites that branch on the Blob backend. */
export function isBlobBackend(bucket: ManagedBucket): boolean {
  return getStorageBackend(bucket) === "blob";
}
