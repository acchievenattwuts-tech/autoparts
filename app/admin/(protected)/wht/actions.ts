"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { reportCriticalError } from "@/lib/error-reporting";
import { requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToDate } from "@/lib/th-date";

/**
 * ทะเบียนภาษีถูกหัก ณ ที่จ่าย — ใช้บันทึกว่าได้รับหนังสือรับรอง 50 ทวิ จากลูกค้าแล้วหรือยัง
 * ยอดภาษีเองแก้ที่ใบเสร็จ/ใบขายต้นทางเท่านั้น เพื่อไม่ให้ยอดเงินกับยอดตัดหนี้หลุดจากกัน
 */

const certificateSchema = z.object({
  id: z.string().min(1),
  certNo: z
    .string()
    .max(50, "เลขที่หนังสือรับรองยาวเกินไป")
    .optional()
    .transform((value) => value?.trim() || null),
  certDate: z
    .string()
    .optional()
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: "รูปแบบวันที่ในหนังสือรับรองไม่ถูกต้อง",
    }),
  received: z.enum(["true", "false"]),
});

export async function updateWhtReceivedCertificate(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = certificateSchema.safeParse({
    id: formData.get("id"),
    certNo: formData.get("certNo") ?? undefined,
    certDate: formData.get("certDate") ?? undefined,
    received: formData.get("received") ?? "false",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { id, certNo, certDate, received } = parsed.data;
  const markReceived = received === "true";

  if (markReceived && !certNo) {
    return { error: "กรุณาระบุเลขที่หนังสือรับรอง 50 ทวิ ก่อนยืนยันว่าได้รับแล้ว" };
  }

  try {
    const existing = await db.whtReceived.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        certNo: true,
        certDate: true,
        certReceivedAt: true,
        receipt: { select: { receiptNo: true } },
        sale: { select: { saleNo: true } },
      },
    });
    if (!existing) return { error: "ไม่พบรายการภาษีหัก ณ ที่จ่าย" };
    if (existing.status === "CANCELLED") return { error: "รายการนี้ถูกยกเลิกแล้ว" };

    const before = {
      certNo: existing.certNo,
      certDate: existing.certDate,
      certReceivedAt: existing.certReceivedAt,
    };
    const after = {
      certNo,
      certDate: certDate ? parseDateOnlyToDate(certDate) : null,
      certReceivedAt: markReceived ? (existing.certReceivedAt ?? new Date()) : null,
    };

    await db.whtReceived.update({ where: { id }, data: after });

    const requestContext = await getRequestContext();
    const diff = diffEntity(before, after);
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "WhtReceived",
      entityId: id,
      entityRef: existing.receipt?.receiptNo ?? existing.sale?.saleNo ?? id,
      before: diff.before,
      after: diff.after,
    });

    revalidatePath("/admin/wht");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "wht.updateCertificate" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
