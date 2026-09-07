import { del } from "@vercel/blob";

import { prepareExpenseAttachment, type PreparedExpenseAttachment } from "@/lib/expense-attachment-storage";
import { WHT_ATTACHMENT_ROOT } from "@/lib/wht-attachment-constants";
import { uploadProductsBucketObject } from "@/lib/products-bucket-storage";

/**
 * ที่เก็บไฟล์หนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้เรา
 *
 * ใช้ตัวตรวจ/แปลงไฟล์ตัวเดียวกับไฟล์แนบใบค่าใช้จ่าย (ตรวจชนิดจริงจาก magic bytes
 * รูปภาพแปลงเป็น WebP ขาวดำย่อขนาด ส่วน PDF เก็บดิบเพื่อรักษาน้ำหนักหลักฐาน)
 * แต่แยก object root และการตรวจสิทธิ์ลบออกจากกัน เพื่อไม่ให้ลบข้ามโมดูลได้
 */

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export type PreparedWhtAttachment = PreparedExpenseAttachment;

/** ตรวจชนิดไฟล์จริงและเตรียมไบต์ที่จะเก็บ — คืน null เมื่อไม่ใช่รูปภาพหรือ PDF ที่รองรับ */
export async function prepareWhtAttachment(bytes: Uint8Array): Promise<PreparedWhtAttachment | null> {
  return prepareExpenseAttachment(bytes);
}

export function buildWhtAttachmentObjectPath(whtReceivedId: string, extension: string): string {
  const safeId = whtReceivedId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${WHT_ATTACHMENT_ROOT}/${safeId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

export async function uploadWhtAttachmentObject(input: {
  whtReceivedId: string;
  prepared: PreparedWhtAttachment;
}): Promise<string> {
  return uploadProductsBucketObject({
    objectPath: buildWhtAttachmentObjectPath(input.whtReceivedId, input.prepared.extension),
    body: input.prepared.body,
    contentType: input.prepared.contentType,
  });
}

/** จริงเฉพาะไฟล์ของโมดูลนี้เท่านั้น — กันไม่ให้ลบ Blob URL อื่นผ่านทางนี้ */
export function isOwnedWhtAttachmentUrl(url: string): boolean {
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
  return objectPath.startsWith(`${WHT_ATTACHMENT_ROOT}/`);
}

/** ลบไฟล์ที่เก็บไว้แบบ best-effort — ไม่ throw เพื่อไม่ให้ล้มทั้ง flow */
export async function deleteWhtAttachmentObjects(urls: string[]): Promise<void> {
  const ownedUrls = urls.filter(isOwnedWhtAttachmentUrl);
  if (ownedUrls.length === 0) return;
  try {
    await del(ownedUrls);
  } catch (error) {
    console.error("[wht-attachment-storage] blob delete failed", error);
  }
}
