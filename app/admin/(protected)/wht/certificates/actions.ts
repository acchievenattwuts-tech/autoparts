"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, dbTx } from "@/lib/db";
import { AuditAction, WhtPayCondition } from "@/lib/generated/prisma";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { reportCriticalError } from "@/lib/error-reporting";
import { requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { cancelWhtCertificate, createStandaloneWhtCertificate } from "@/lib/wht-certificate";

/**
 * หนังสือรับรอง 50 ทวิ ส่วนใหญ่ถูกออกอัตโนมัติจากใบค่าใช้จ่าย/ใบจ่ายชำระหนี้
 * ที่นี่รองรับ 2 กรณีที่เหลือ: ออกใบเดี่ยวโดยไม่มีเอกสารต้นทาง และยกเลิกใบที่ออกไปแล้ว
 */

const standaloneSchema = z.object({
  supplierId: z.string().min(1, "กรุณาเลือกผู้ถูกหักภาษี"),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาระบุวันที่จ่ายเงิน"),
  incomeTypeId: z.string().min(1, "กรุณาเลือกประเภทเงินได้"),
  baseAmount: z.coerce.number().gt(0, "จำนวนเงินที่จ่ายต้องมากกว่า 0"),
  rate: z.coerce.number().min(0).max(100),
  taxAmount: z.coerce.number().gt(0, "ยอดภาษีที่หักต้องมากกว่า 0"),
  payCondition: z.nativeEnum(WhtPayCondition).default(WhtPayCondition.WITHHELD),
  note: z
    .string()
    .max(500)
    .optional()
    .transform((value) => value?.trim() || null),
});

export async function createStandaloneCertificate(
  formData: FormData,
): Promise<{ success?: boolean; certNo?: string; certificateId?: string; error?: string }> {
  const session = await requirePermission("wht.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = standaloneSchema.safeParse({
    supplierId: formData.get("supplierId"),
    payDate: formData.get("payDate"),
    incomeTypeId: formData.get("incomeTypeId"),
    baseAmount: formData.get("baseAmount"),
    rate: formData.get("rate"),
    taxAmount: formData.get("taxAmount"),
    payCondition: formData.get("payCondition") ?? WhtPayCondition.WITHHELD,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = parsed.data;
  if (data.taxAmount > data.baseAmount + 0.005) {
    return { error: "ยอดภาษีที่หักมากกว่าจำนวนเงินที่จ่าย" };
  }

  try {
    const payDate = parseDateOnlyToDate(data.payDate);
    const created = await dbTx(async (tx) =>
      createStandaloneWhtCertificate(tx, {
        supplierId: data.supplierId,
        payDate,
        lines: [
          {
            incomeTypeId: data.incomeTypeId,
            baseAmount: data.baseAmount,
            rate: data.rate,
            taxAmount: data.taxAmount,
            payCondition: data.payCondition,
          },
        ],
        note: data.note,
        userId: session.user.id,
      }),
    );

    const requestContext = await getRequestContext();
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "WhtCertificate",
      entityId: created.id,
      entityRef: created.certNo,
      after: { ...data, certNo: created.certNo, source: "STANDALONE" },
    });

    revalidatePath("/admin/wht/certificates");
    return { success: true, certNo: created.certNo, certificateId: created.id };
  } catch (err) {
    if (err instanceof Error && err.message.includes("ข้อมูลภาษี")) {
      return { error: err.message };
    }
    await reportCriticalError(err, { scope: "wht.createStandaloneCertificate" });
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelSchema = z.object({
  certificateId: z.string().min(1),
  cancelNote: z
    .string()
    .max(200)
    .optional()
    .transform((value) => value?.trim() || null),
});

export async function cancelCertificate(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSchema.safeParse({
    certificateId: formData.get("certificateId"),
    cancelNote: formData.get("cancelNote") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { certificateId, cancelNote } = parsed.data;

  try {
    const existing = await db.whtCertificate.findUnique({
      where: { id: certificateId },
      select: {
        certNo: true,
        status: true,
        cancelNote: true,
        expense: { select: { expenseNo: true } },
        supplierPayment: { select: { paymentNo: true } },
      },
    });
    if (!existing) return { error: "ไม่พบหนังสือรับรอง" };
    if (existing.status === "CANCELLED") return { error: "หนังสือรับรองถูกยกเลิกไปแล้ว" };

    // ใบที่ออกจากเอกสารต้นทางต้องยกเลิกที่ต้นทาง เพื่อไม่ให้ยอดเงินกับใบรับรองหลุดจากกัน
    const sourceNo = existing.expense?.expenseNo ?? existing.supplierPayment?.paymentNo ?? null;
    if (sourceNo) {
      return {
        error: `ใบนี้ออกจากเอกสาร ${sourceNo} — ให้เอายอดภาษีออกหรือยกเลิกที่เอกสารต้นทางแทน`,
      };
    }

    await dbTx(async (tx) => cancelWhtCertificate(tx, certificateId, cancelNote));

    const after = await db.whtCertificate.findUnique({
      where: { id: certificateId },
      select: { status: true, cancelNote: true },
    });
    const requestContext = await getRequestContext();
    const diff = diffEntity({ status: existing.status, cancelNote: existing.cancelNote }, after ?? {});
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CANCEL,
      entityType: "WhtCertificate",
      entityId: certificateId,
      entityRef: existing.certNo,
      before: diff.before,
      after: diff.after,
      meta: { cancelNote },
    });

    revalidatePath("/admin/wht/certificates");
    revalidatePath(`/admin/wht/certificates/${certificateId}`);
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "wht.cancelCertificate" });
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
