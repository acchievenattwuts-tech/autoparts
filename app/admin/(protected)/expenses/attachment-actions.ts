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
  EXPENSE_ATTACHMENT_MAX_FILES,
  EXPENSE_ATTACHMENT_MAX_FILE_BYTES,
} from "@/lib/expense-attachment-constants";
import {
  deleteExpenseAttachmentObjects,
  prepareExpenseAttachment,
  uploadExpenseAttachmentObject,
} from "@/lib/expense-attachment-storage";

/**
 * Attachments are optional evidence (transfer slips / receipts) for an expense.
 * They never take part in the accounting flow — no cash/bank, profit-fact or VAT
 * side effects — so they are handled outside `createExpense`/`updateExpense`.
 */

const MAX_FILE_NAME_LENGTH = 120;
const idSchema = z.string().min(1).max(50).regex(/^[a-z0-9]+$/, "รหัสไม่ถูกต้อง");

const sanitizeFileName = (rawName: string): string => {
  const trimmed = rawName.replace(/[\\/\r\n]/g, " ").trim();
  return (trimmed || "attachment").slice(0, MAX_FILE_NAME_LENGTH);
};

/**
 * Uploads one or more evidence files for an expense. Every file's real type is
 * detected from its bytes (never the client-supplied MIME) and images are
 * converted to compact grayscale WebP before storage.
 */
export async function uploadExpenseAttachments(
  expenseId: string,
  formData: FormData,
): Promise<{ success?: boolean; uploaded?: number; error?: string }> {
  const session = await requirePermission("expenses.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsedId = idSchema.safeParse(expenseId);
  if (!parsedId.success) return { error: "รหัสเอกสารไม่ถูกต้อง" };

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { error: "ไม่พบไฟล์แนบ" };

  const uploadedUrls: string[] = [];
  try {
    const [expense, existingCount] = await Promise.all([
      db.expense.findUnique({
        where: { id: parsedId.data },
        select: { id: true, expenseNo: true, status: true },
      }),
      db.expenseAttachment.count({ where: { expenseId: parsedId.data } }),
    ]);

    if (!expense) return { error: "ไม่พบเอกสาร" };
    if (expense.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแนบไฟล์ได้" };
    if (existingCount + files.length > EXPENSE_ATTACHMENT_MAX_FILES) {
      return { error: `แนบไฟล์ได้สูงสุด ${EXPENSE_ATTACHMENT_MAX_FILES} ไฟล์ต่อเอกสาร` };
    }

    for (const file of files) {
      if (file.size > EXPENSE_ATTACHMENT_MAX_FILE_BYTES) {
        return { error: `ไฟล์ "${sanitizeFileName(file.name)}" มีขนาดเกิน 3MB` };
      }
    }

    const requestContext = await getRequestContext();
    const savedNames: string[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await prepareExpenseAttachment(bytes);
      if (!prepared) {
        await deleteExpenseAttachmentObjects(uploadedUrls);
        return { error: `ไฟล์ "${sanitizeFileName(file.name)}" ไม่ใช่รูปภาพหรือ PDF ที่รองรับ` };
      }

      const url = await uploadExpenseAttachmentObject({ expenseId: expense.id, prepared });
      uploadedUrls.push(url);

      const fileName = sanitizeFileName(file.name);
      savedNames.push(fileName);
      await db.expenseAttachment.create({
        data: {
          expenseId: expense.id,
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
      entityType: "Expense",
      entityId: expense.id,
      entityRef: expense.expenseNo,
      meta: { attachmentsAdded: savedNames },
    });

    revalidatePath("/admin/expenses");
    revalidatePath(`/admin/expenses/${expense.id}`);
    return { success: true, uploaded: savedNames.length };
  } catch (err) {
    console.error("[uploadExpenseAttachments]", err);
    await deleteExpenseAttachmentObjects(uploadedUrls);
    return { error: "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

/** Removes one attachment (DB row first, then the stored object). */
export async function deleteExpenseAttachment(
  attachmentId: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("expenses.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsedId = idSchema.safeParse(attachmentId);
  if (!parsedId.success) return { error: "รหัสไฟล์แนบไม่ถูกต้อง" };

  try {
    const attachment = await db.expenseAttachment.findUnique({
      where: { id: parsedId.data },
      select: {
        id: true,
        url: true,
        fileName: true,
        expense: { select: { id: true, expenseNo: true, status: true } },
      },
    });
    if (!attachment) return { error: "ไม่พบไฟล์แนบ" };
    if (attachment.expense.status === "CANCELLED") {
      return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถลบไฟล์แนบได้" };
    }

    const requestContext = await getRequestContext();
    await db.expenseAttachment.delete({ where: { id: attachment.id } });
    await deleteExpenseAttachmentObjects([attachment.url]);

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "Expense",
      entityId: attachment.expense.id,
      entityRef: attachment.expense.expenseNo,
      meta: { attachmentRemoved: attachment.fileName },
    });

    revalidatePath("/admin/expenses");
    revalidatePath(`/admin/expenses/${attachment.expense.id}`);
    return { success: true };
  } catch (err) {
    console.error("[deleteExpenseAttachment]", err);
    return { error: "ลบไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
