import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { LineMessageContent } from "@/lib/line-messaging";

/**
 * Private storage for payment-slip images. Slips are PII (bank/account/name), so
 * they live in a NON-public bucket and are only viewable via short-lived signed
 * URLs by authenticated admins. Images are compressed hard (grayscale WebP,
 * downscaled) to keep storage tiny — a typical slip ends up ~20–50KB.
 */

const BUCKET = "payment-slips";
const MAX_DIMENSION = 1000; // px — enough to read amounts/reference numbers.
const WEBP_QUALITY = 60;
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Gallery view caches signed URLs in the DB (PaymentSlip.imageSignedUrl) to avoid
 * a Supabase Storage call per thumbnail on every page render. A long TTL keeps the
 * cache warm; URLs are refreshed in batch only when they are missing or within the
 * refresh buffer of expiry.
 */
export const GALLERY_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const GALLERY_SIGNED_URL_REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // refresh when < 1 day left

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Path layout: payment-slips/YYYY/MM/DD/<slipId>.webp */
export function buildPaymentSlipObjectPath(slipId: string, date: Date): string {
  const yyyy = date.getFullYear().toString();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${slipId}.webp`;
}

let bucketEnsured = false;
async function ensureBucket(client: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  // Idempotent: ignore "already exists". Bucket stays private (public: false).
  const { error } = await client.storage.createBucket(BUCKET, { public: false });
  if (error && !/exist/i.test(error.message)) {
    throw new Error(`CREATE_BUCKET_FAILED:${error.message}`);
  }
  bucketEnsured = true;
}

/** Compresses an inbound image to a small grayscale WebP buffer. */
export async function compressSlipImage(content: LineMessageContent): Promise<Buffer> {
  const input = Buffer.from(content.dataBase64, "base64");
  return sharp(input)
    .rotate() // honor EXIF orientation
    .grayscale()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/**
 * Compresses + uploads a slip image. Returns the stored object path (saved in
 * PaymentSlip.imageUrl) or null when storage is unavailable. Never throws to the
 * caller's pipeline — image persistence is best-effort.
 */
export async function storePaymentSlipImage(input: {
  slipId: string;
  date: Date;
  content: LineMessageContent;
}): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;

  try {
    await ensureBucket(client);
    const webp = await compressSlipImage(input.content);
    const path = buildPaymentSlipObjectPath(input.slipId, input.date);

    const { error } = await client.storage
      .from(BUCKET)
      .upload(path, webp, { contentType: "image/webp", upsert: true });

    if (error) {
      console.error("[payment-slip-storage] upload failed", error.message);
      return null;
    }
    return path;
  } catch (error) {
    console.error("[payment-slip-storage] store failed", error);
    return null;
  }
}

/** Deletes a stored slip image (used when an admin rejects a slip). Best-effort. */
export async function deletePaymentSlipImage(path: string): Promise<void> {
  const client = getServiceClient();
  if (!client) return;
  try {
    await client.storage.from(BUCKET).remove([path]);
  } catch (error) {
    console.error("[payment-slip-storage] delete failed", error);
  }
}

/** Creates a short-lived signed URL so an authenticated admin can view the slip. */
export async function createPaymentSlipSignedUrl(path: string): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  try {
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Creates signed URLs for many slip paths in ONE Supabase call (instead of N).
 * Returns a Map keyed by object path. Best-effort: paths that fail are simply
 * absent from the map, and a total failure returns an empty map.
 */
export async function createPaymentSlipSignedUrlsBatch(
  paths: string[],
  ttlSeconds: number,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const client = getServiceClient();
  if (!client || paths.length === 0) return result;

  try {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttlSeconds);
    if (error || !data) return result;
    for (const item of data) {
      if (item.path && item.signedUrl) {
        result.set(item.path, item.signedUrl);
      }
    }
  } catch {
    /* best-effort — caller falls back to whatever is cached */
  }
  return result;
}
