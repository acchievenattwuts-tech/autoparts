"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import {
  WHT_ATTACHMENT_MAX_FILES,
  WHT_ATTACHMENT_MAX_FILE_BYTES,
} from "@/lib/wht-attachment-constants";
import {
  deleteWhtAttachmentObjects,
  prepareWhtAttachment,
  uploadWhtAttachmentObject,
} from "@/lib/wht-attachment-storage";

/**
 * ไฟล์แนบหนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้เรา — เป็นหลักฐานสำหรับเครดิตภาษี
 * ไม่มีผลกับยอดเงิน ยอดตัดหนี้ หรือกำไร จึงแยกออกจาก flow บันทึกใบเสร็จ/ใบขาย
 */

const MAX_FILE_NAME_LENGTH = 120;
const idSchema = z.string().min(1).max(50).regex(/^[a-z0-9]+$/, "รหัสไม่ถูกต้อง");

const sanitizeFileName = (rawName: string): string => {
  const trimmed = rawName.replace(/[\\/\r\n]/g, " ").trim();
  return (trimmed || "attachment").slice(0, MAX_FILE_NAME_LENGTH);
};

export async function uploadWhtAttachments(
  whtReceivedId: string,
  formData: FormData,
): Promise<{ success?: boolean; uploaded?: number; error?: string }> {
  const session = await requirePermission("wht.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsedId = idSchema.safeParse(whtReceivedId);
  if (!parsedId.success) return { error: "รหัสรายการไม่ถูกต้อง" };

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { error: "ไม่พบไฟล์แนบ" };

  const uploadedUrls: string[] = [];
  try {
    const [record, existingCount] = await Promise.all([
      db.whtReceived.findUnique({
        where: { id: parsedId.data },
        select: {
          id: true,
          status: true,
          certNo: true,
          receipt: { select: { receiptNo: true } },
          sale: { select: { saleNo: true } },
        },
      }),
      db.whtReceivedAttachment.count({ where: { whtReceivedId: parsedId.data } }),
    ]);

    if (!record) return { error: "ไม่พบรายการภาษีหัก ณ ที่จ่าย" };
    if (record.status === "CANCELLED") return { error: "รายการถูกยกเลิกแล้ว ไม่สามารถแนบไฟล์ได้" };
    if (existingCount + files.length > WHT_ATTACHMENT_MAX_FILES) {
      return { error: `แนบไฟล์ได้สูงสุด ${WHT_ATTACHMENT_MAX_FILES} ไฟล์ต่อรายการ` };
    }

    for (const file of files) {
      if (file.size > WHT_ATTACHMENT_MAX_FILE_BYTES) {
        return { error: `ไฟล์ "${sanitizeFileName(file.name)}" มีขนาดเกิน 3MB` };
      }
    }

    const requestContext = await getRequestContext();
    const savedNames: string[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await prepareWhtAttachment(bytes);
      if (!prepared) {
        await deleteWhtAttachmentObjects(uploadedUrls);
        return { error: `ไฟล์ "${sanitizeFileName(file.name)}" ไม่ใช่รูปภาพหรือ PDF ที่รองรับ` };
      }

      const url = await uploadWhtAttachmentObject({ whtReceivedId: record.id, prepared });
      uploadedUrls.push(url);

      const fileName = sanitizeFileName(file.name);
      savedNames.push(fileName);
      await db.whtReceivedAttachment.create({
        data: {
          whtReceivedId: record.id,
          url,
          fileName,
          contentType: prepared.contentType,
          fileSize: prepared.body.byteLength,
          uploadedById: session.user.id!,
        },
      });
    }

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "WhtReceived",
      entityId: record.id,
      entityRef: record.receipt?.receiptNo ?? record.sale?.saleNo ?? record.certNo ?? record.id,
      meta: { attachmentsAdded: savedNames },
    });

    revalidatePath("/admin/wht");
    return { success: true, uploaded: savedNames.length };
  } catch (err) {
    console.error("[uploadWhtAttachments]", err);
    await deleteWhtAttachmentObjects(uploadedUrls);
    return { error: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function deleteWhtAttachment(
  attachmentId: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsedId = idSchema.safeParse(attachmentId);
  if (!parsedId.success) return { error: "รหัสไฟล์แนบไม่ถูกต้อง" };

  try {
    const attachment = await db.whtReceivedAttachment.findUnique({
      where: { id: parsedId.data },
      select: {
        id: true,
        url: true,
        fileName: true,
        whtReceived: {
          select: {
            id: true,
            status: true,
            certNo: true,
            receipt: { select: { receiptNo: true } },
            sale: { select: { saleNo: true } },
          },
        },
      },
    });
    if (!attachment) return { error: "ไม่พบไฟล์แนบ" };
    if (attachment.whtReceived.status === "CANCELLED") {
      return { error: "รายการถูกยกเลิกแล้ว ไม่สามารถลบไฟล์แนบได้" };
    }

    const requestContext = await getRequestContext();
    await db.whtReceivedAttachment.delete({ where: { id: attachment.id } });
    await deleteWhtAttachmentObjects([attachment.url]);

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "WhtReceived",
      entityId: attachment.whtReceived.id,
      entityRef:
        attachment.whtReceived.receipt?.receiptNo ??
        attachment.whtReceived.sale?.saleNo ??
        attachment.whtReceived.certNo ??
        attachment.whtReceived.id,
      meta: { attachmentRemoved: attachment.fileName },
    });

    revalidatePath("/admin/wht");
    return { success: true };
  } catch (err) {
    console.error("[deleteWhtAttachment]", err);
    return { error: "ลบไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
