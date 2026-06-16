import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PURCHASE_OCR_BUCKET } from "@/lib/purchase-invoice-ocr-types";

/**
 * Temporary private storage for purchase-invoice OCR uploads. Files are uploaded
 * directly from the browser via short-lived signed upload URLs (so they bypass the
 * 3mb Server Action body limit and Vercel's 4.5MB function-body cap), fetched once
 * by the server to send to Gemini, then deleted immediately. A daily cron sweeps
 * any orphans (e.g. the user uploaded but never ran OCR). Bucket is NOT public.
 */

const BUCKET = PURCHASE_OCR_BUCKET;
/** Orphan cutoff for the cleanup cron — files older than this are swept. */
export const PURCHASE_OCR_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIST_PAGE_SIZE = 1000;

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
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

function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export interface PurchaseOcrUploadTicket {
  path: string;
  token: string;
  signedUrl: string;
}

/**
 * Creates one signed upload URL per file. The browser uploads directly to each
 * (single-use, scoped to that exact path), so the bytes never pass through the
 * Server Action body. Returns null when storage isn't configured.
 */
export async function createPurchaseOcrUploadTickets(
  mimeTypes: string[],
): Promise<PurchaseOcrUploadTicket[] | null> {
  const client = getServiceClient();
  if (!client) return null;

  await ensureBucket(client);

  const tickets: PurchaseOcrUploadTicket[] = [];
  for (const mime of mimeTypes) {
    const path = `${randomUUID()}.${extensionForMime(mime)}`;
    const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`SIGNED_UPLOAD_FAILED:${error?.message ?? "no-data"}`);
    }
    tickets.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
  }
  return tickets;
}

export interface PurchaseOcrFetchedFile {
  buffer: Buffer;
  contentType: string;
  bytes: number;
}

/**
 * Downloads one stored OCR file. Returns null when the object is missing or
 * storage is unavailable, so the caller can skip it without throwing.
 */
export async function fetchPurchaseOcrFile(path: string): Promise<PurchaseOcrFetchedFile | null> {
  const client = getServiceClient();
  if (!client) return null;

  const { data, error } = await client.storage.from(BUCKET).download(path);
  if (error || !data) return null;

  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type || "application/octet-stream", bytes: buffer.byteLength };
}

/** Deletes stored OCR files. Best-effort — never throws to the caller's pipeline. */
export async function deletePurchaseOcrFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const client = getServiceClient();
  if (!client) return;
  try {
    await client.storage.from(BUCKET).remove(paths);
  } catch (error) {
    console.error("[purchase-ocr-storage] delete failed", error);
  }
}

export interface PurchaseOcrCleanupSummary {
  scanned: number;
  deleted: number;
}

/**
 * Sweeps orphan temp files older than {@link PURCHASE_OCR_TEMP_MAX_AGE_MS}. Used by
 * the daily cron as a backstop for files that escaped the immediate per-request
 * delete (e.g. the user uploaded but never triggered OCR).
 */
export async function cleanupExpiredPurchaseOcrFiles(): Promise<PurchaseOcrCleanupSummary> {
  const client = getServiceClient();
  if (!client) return { scanned: 0, deleted: 0 };

  const cutoff = Date.now() - PURCHASE_OCR_TEMP_MAX_AGE_MS;
  const expired: string[] = [];
  let scanned = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage.from(BUCKET).list("", {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error || !data || data.length === 0) break;

    scanned += data.length;
    for (const item of data) {
      const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;
      if (createdAt && createdAt < cutoff) {
        expired.push(item.name);
      }
    }

    if (data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  if (expired.length > 0) {
    await client.storage.from(BUCKET).remove(expired);
  }
  return { scanned, deleted: expired.length };
}
