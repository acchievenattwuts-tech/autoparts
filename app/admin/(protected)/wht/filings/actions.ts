"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, dbTx } from "@/lib/db";
import {
  AuditAction,
  WhtFilingChannel,
  WhtFilingSubmissionType,
  WhtFormType,
} from "@/lib/generated/prisma";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { reportCriticalError } from "@/lib/error-reporting";
import { requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { cancelWhtFiling, createWhtFiling, markWhtFilingFiled } from "@/lib/wht-filing";

const createSchema = z
  .object({
    formType: z.enum([WhtFormType.PND3, WhtFormType.PND53]),
    taxMonth: z.coerce.number().int().min(1).max(12),
    taxYear: z.coerce.number().int().min(2500).max(2700),
    submissionType: z.nativeEnum(WhtFilingSubmissionType).default(WhtFilingSubmissionType.NORMAL),
    additionalSeq: z.coerce.number().int().min(0).max(99).default(0),
    surchargeAmount: z.coerce.number().min(0).default(0),
    note: z
      .string()
      .max(500)
      .optional()
      .transform((value) => value?.trim() || null),
  })
  .refine(
    (value) =>
      value.submissionType === WhtFilingSubmissionType.NORMAL
        ? value.additionalSeq === 0
        : value.additionalSeq >= 1,
    { message: "ยื่นเพิ่มเติมต้องระบุครั้งที่ตั้งแต่ 1 ขึ้นไป", path: ["additionalSeq"] },
  );

export async function createFiling(
  formData: FormData,
): Promise<{ success?: boolean; filingId?: string; filingNo?: string; error?: string }> {
  const session = await requirePermission("wht_filings.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = createSchema.safeParse({
    formType: formData.get("formType"),
    taxMonth: formData.get("taxMonth"),
    taxYear: formData.get("taxYear"),
    submissionType: formData.get("submissionType") ?? WhtFilingSubmissionType.NORMAL,
    additionalSeq: formData.get("additionalSeq") ?? 0,
    surchargeAmount: formData.get("surchargeAmount") ?? 0,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const created = await dbTx(async (tx) =>
      createWhtFiling(tx, { ...parsed.data, userId: session.user.id! }),
    );

    const requestContext = await getRequestContext();
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "WhtFiling",
      entityId: created.id,
      entityRef: created.filingNo,
      after: { ...parsed.data, filingNo: created.filingNo, certificateCount: created.certificateCount },
    });

    revalidatePath("/admin/wht/filings");
    revalidatePath("/admin/wht/certificates");
    return { success: true, filingId: created.id, filingNo: created.filingNo };
  } catch (err) {
    if (err instanceof Error && err.message.includes("ไม่มีหนังสือรับรอง")) {
      return { error: err.message };
    }
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "มีรอบยื่นของแบบ เดือนภาษี และครั้งที่นี้อยู่แล้ว" };
    }
    await reportCriticalError(err, { scope: "wht.createFiling" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const markFiledSchema = z.object({
  filingId: z.string().min(1),
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาระบุวันที่ยื่นแบบ"),
  filedChannel: z.nativeEnum(WhtFilingChannel),
  rdRefNo: z
    .string()
    .max(50)
    .optional()
    .transform((value) => value?.trim() || null),
});

export async function markFilingFiled(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht_filings.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = markFiledSchema.safeParse({
    filingId: formData.get("filingId"),
    filedAt: formData.get("filedAt"),
    filedChannel: formData.get("filedChannel"),
    rdRefNo: formData.get("rdRefNo") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { filingId, filedAt, filedChannel, rdRefNo } = parsed.data;

  try {
    const before = await db.whtFiling.findUnique({
      where: { id: filingId },
      select: { filingNo: true, status: true, filedAt: true, filedChannel: true, rdRefNo: true },
    });
    if (!before) return { error: "ไม่พบรอบยื่นแบบ" };

    await dbTx(async (tx) =>
      markWhtFilingFiled(tx, filingId, {
        filedAt: parseDateOnlyToDate(filedAt),
        filedChannel,
        rdRefNo,
      }),
    );

    const after = await db.whtFiling.findUnique({
      where: { id: filingId },
      select: { status: true, filedAt: true, filedChannel: true, rdRefNo: true },
    });
    const requestContext = await getRequestContext();
    const diff = diffEntity(before, after ?? {});
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: "WhtFiling",
      entityId: filingId,
      entityRef: before.filingNo,
      before: diff.before,
      after: diff.after,
    });

    revalidatePath("/admin/wht/filings");
    revalidatePath(`/admin/wht/filings/${filingId}`);
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "wht.markFilingFiled" });
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelSchema = z.object({
  filingId: z.string().min(1),
  cancelNote: z
    .string()
    .max(200)
    .optional()
    .transform((value) => value?.trim() || null),
});

export async function cancelFiling(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("wht_filings.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSchema.safeParse({
    filingId: formData.get("filingId"),
    cancelNote: formData.get("cancelNote") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { filingId, cancelNote } = parsed.data;

  try {
    const before = await db.whtFiling.findUnique({
      where: { id: filingId },
      select: { filingNo: true, status: true, totalRecords: true },
    });
    if (!before) return { error: "ไม่พบรอบยื่นแบบ" };
    if (before.status === "CANCELLED") return { error: "รอบยื่นนี้ถูกยกเลิกไปแล้ว" };

    await dbTx(async (tx) => cancelWhtFiling(tx, filingId, cancelNote));

    const requestContext = await getRequestContext();
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CANCEL,
      entityType: "WhtFiling",
      entityId: filingId,
      entityRef: before.filingNo,
      before: { status: before.status, totalRecords: before.totalRecords },
      after: { status: "CANCELLED" },
      meta: { cancelNote },
    });

    revalidatePath("/admin/wht/filings");
    revalidatePath(`/admin/wht/filings/${filingId}`);
    revalidatePath("/admin/wht/certificates");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "wht.cancelFiling" });
    return { error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
