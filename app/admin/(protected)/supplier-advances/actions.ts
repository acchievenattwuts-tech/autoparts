"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateSupplierAdvanceNo } from "@/lib/doc-number";
import { getDocumentMutationBlockMessage } from "@/lib/document-mutation-guard";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  DocumentPaymentDocType,
  PaymentMethod,
  Prisma,
} from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements,
} from "@/lib/cash-bank";
import {
  assertPaymentsMatchTotal,
  clearDocumentPayments,
  derivePrimaryAccountId,
  parseDocumentPaymentRows,
  replaceDocumentPayments,
  toCashBankEntries,
  type DocumentPaymentRow,
} from "@/lib/document-payments";
import { recalculateSupplierAdvanceAmountRemain } from "@/lib/amount-remain";
import { parseDateOnlyToDate } from "@/lib/th-date";

const supplierAdvanceSchema = z.object({
  supplierId: z.string().min(1, "กรุณาเลือกซัพพลายเออร์"),
  advanceDate: z.string().min(1, "กรุณาระบุวันที่"),
  totalAmount: z.coerce.number().positive("ยอดเงินมัดจำต้องมากกว่า 0"),
  note: z.string().max(500).optional(),
});

async function resolveSupplierAdvancePaymentMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  payments: DocumentPaymentRow[],
): Promise<PaymentMethod> {
  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { type: true },
  });

  if (accounts.length !== accountIds.length) {
    throw new Error("ไม่พบบัญชีจ่ายเงินที่เลือก");
  }

  const allCash = accounts.every((account) => account.type === "CASH");
  return allCash ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

/** Parse + validate advance payment channels (always requires full cash out). */
function parseAdvancePayments(
  formData: FormData,
  totalAmount: number,
): { ok: true; payments: DocumentPaymentRow[] } | { ok: false; error: string } {
  let payments: DocumentPaymentRow[];
  try {
    payments = parseDocumentPaymentRows(formData.get("payments"));
  } catch {
    return { ok: false, error: "รูปแบบข้อมูลช่องทางจ่ายเงินไม่ถูกต้อง" };
  }
  if (payments.length === 0) {
    return { ok: false, error: "กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง" };
  }
  try {
    assertPaymentsMatchTotal(payments, totalAmount);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ยอดช่องทางจ่ายเงินไม่ถูกต้อง",
    };
  }
  return { ok: true, payments };
}

async function getActiveSupplierPaymentRefs(advanceId: string,
): Promise<string[]> {
  const refs = await db.supplierPaymentItem.findMany({
    where: {
      advanceId,
      payment: { status: "ACTIVE" },
    },
    select: {
      payment: { select: { paymentNo: true } },
    },
  });

  return [...new Set(refs.map((item) => item.payment.paymentNo))];
}

async function getActiveSupplierAdvanceRefundRefs(
  advanceId: string,
): Promise<string[]> {
  const rows = await db.supplierAdvanceRefund.findMany({
    where: { supplierAdvanceId: advanceId, status: "ACTIVE" },
    select: { refundNo: true },
  });
  return rows.map((row) => row.refundNo);
}

async function lockSupplierAdvance(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "SupplierAdvance" WHERE id = ${id} FOR UPDATE`,
  );
}

async function getSupplierAdvanceAuditSnapshot(advanceId: string) {
  const [advance, payments] = await Promise.all([
    db.supplierAdvance.findUnique({
      where: { id: advanceId },
      include: {
        supplier: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    }),
    db.documentPayment.findMany({
      where: { docType: DocumentPaymentDocType.SUPPLIER_ADVANCE, docId: advanceId,
      },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

  if (!advance) return null;

  return {
    id: advance.id,
    advanceNo: advance.advanceNo,
    advanceDate: advance.advanceDate,
    status: advance.status,
    supplierId: advance.supplierId,
    supplierRef: advance.supplier.code ?? advance.supplier.name,
    totalAmount: advance.totalAmount,
    amountRemain: advance.amountRemain,
    paymentMethod: advance.paymentMethod,
    cashBankAccountId: advance.cashBankAccountId,
    note: advance.note,
    cancelNote: advance.cancelNote,
    cancelledAt: advance.cancelledAt,
    payments: payments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: payment.amount,
    })),
  };
}

export async function createSupplierAdvance(
  formData: FormData,
): Promise<{ success: boolean; advanceNo?: string; error?: string }> {
  const session = await requirePermission("supplier_advances.create").catch(() => null,
  );
  if (!session?.user?.id) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };
  }

  let parsed: z.infer<typeof supplierAdvanceSchema>;
  try {
    parsed = supplierAdvanceSchema.parse({
      supplierId: formData.get("supplierId"),
      advanceDate: formData.get("advanceDate"),
      totalAmount: formData.get("totalAmount"),
      note: formData.get("note") || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
      };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  const paymentsResult = parseAdvancePayments(formData, parsed.totalAmount);
  if (!paymentsResult.ok) return { success: false, error: paymentsResult.error };
  const payments = paymentsResult.payments;
  const primaryAccountId = derivePrimaryAccountId(payments);

  const advanceDate = parseDateOnlyToDate(parsed.advanceDate);
  const advanceNo = await generateSupplierAdvanceNo(advanceDate);
  let createdAdvanceId = "";

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const paymentMethod = await resolveSupplierAdvancePaymentMethod(tx, payments,
      );

      const advance = await tx.supplierAdvance.create({
        data: {
          advanceNo,
          advanceDate,
          supplierId: parsed.supplierId,
          userId: session.user.id,
          totalAmount: parsed.totalAmount,
          amountRemain: parsed.totalAmount,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: primaryAccountId,
        },
      });
      createdAdvanceId = advance.id;

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.SUPPLIER_ADVANCE,
        advance.id,
        CashBankDirection.OUT,
        payments,
      );
      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_ADVANCE,
        advance.id,
        toCashBankEntries(payments, {
          txnDate: advanceDate,
          direction: CashBankDirection.OUT,
          referenceNo: advanceNo,
          note: parsed.note?.trim() || null,
        }),
      );
    });

    const afterSnapshot = createdAdvanceId
      ? await getSupplierAdvanceAuditSnapshot(createdAdvanceId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "SupplierAdvance",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.advanceNo,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/supplier-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true, advanceNo };
  } catch (error) {
    console.error("[createSupplierAdvance]", error);
    return {
      success: false,
      error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}

export async function updateSupplierAdvance(
  id: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_advances.update").catch(() => null,
  );
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const existing = await db.supplierAdvance.findUnique({
    where: { id },
    select: {
      id: true,
      advanceNo: true,
      status: true,
    },
  });

  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") {
    return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  }
  const refundRefs = await getActiveSupplierAdvanceRefundRefs(id);
  if (refundRefs.length === 0) {
    const mutationBlockMessage = await getDocumentMutationBlockMessage("SupplierAdvance", id, "update",
    );
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  const activeRefs = await getActiveSupplierPaymentRefs(id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถแก้ไขได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }
  }

  let parsed: z.infer<typeof supplierAdvanceSchema>;
  try {
    parsed = supplierAdvanceSchema.parse({
      supplierId: formData.get("supplierId"),
      advanceDate: formData.get("advanceDate"),
      totalAmount: formData.get("totalAmount"),
      note: formData.get("note") || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const paymentsResult = parseAdvancePayments(formData, parsed.totalAmount);
  if (!paymentsResult.ok) return { error: paymentsResult.error };
  const payments = paymentsResult.payments;
  const primaryAccountId = derivePrimaryAccountId(payments);

  const advanceDate = parseDateOnlyToDate(parsed.advanceDate);

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getSupplierAdvanceAuditSnapshot(id);
    await dbTx(async (tx) => {
      await lockSupplierAdvance(tx, id);
      const lockedRefundCount = await tx.supplierAdvanceRefund.count({
        where: { supplierAdvanceId: id, status: "ACTIVE" },
      });
      if (lockedRefundCount > 0) {
        await tx.supplierAdvance.update({
          where: { id },
          data: { note: parsed.note?.trim() || null },
        });
        return;
      }
      const paymentMethod = await resolveSupplierAdvancePaymentMethod(tx, payments,
      );

      await tx.supplierAdvance.update({
        where: { id },
        data: {
          advanceDate,
          supplierId: parsed.supplierId,
          totalAmount: parsed.totalAmount,
          paymentMethod,
          note: parsed.note?.trim() || null,
          cashBankAccountId: primaryAccountId,
        },
      });

      // Recalculate amountRemain from active SupplierPayment usages instead of
      // blindly resetting to totalAmount (which would erase existing applications)
      await recalculateSupplierAdvanceAmountRemain(tx, id);

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.SUPPLIER_ADVANCE,
        id,
        CashBankDirection.OUT,
        payments,
      );
      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SUPPLIER_ADVANCE,
        id,
        toCashBankEntries(payments, {
          txnDate: advanceDate,
          direction: CashBankDirection.OUT,
          referenceNo: existing.advanceNo,
          note: parsed.note?.trim() || null,
        }),
      );
    });

    const afterSnapshot = await getSupplierAdvanceAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "SupplierAdvance",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.advanceNo,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/supplier-advances");
    revalidatePath(`/admin/supplier-advances/${id}`);
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[updateSupplierAdvance]", error);
    return {
      error: "เกิดข้อผิดพลาด ไม่สามารถแก้ไขเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}

const cancelSupplierAdvanceSchema = z.object({
  advanceId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelSupplierAdvance(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("supplier_advances.cancel").catch(() => null,
  );
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSupplierAdvanceSchema.safeParse({
    advanceId: formData.get("advanceId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const advance = await db.supplierAdvance.findUnique({
    where: { id: parsed.data.advanceId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!advance) return { error: "ไม่พบเอกสาร" };
  if (advance.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("SupplierAdvance", advance.id, "cancel",
  );
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  const activeRefs = await getActiveSupplierPaymentRefs(advance.id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }
  const refundRefs = await getActiveSupplierAdvanceRefundRefs(advance.id);
  if (refundRefs.length > 0)
    return {
      error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกอ้างอิงในเอกสารรับคืนเงินมัดจำ: ${refundRefs.join(", ")}`,
    };

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getSupplierAdvanceAuditSnapshot(advance.id);
    await dbTx(async (tx) => {
      await lockSupplierAdvance(tx, advance.id);
      const lockedRefunds = await tx.supplierAdvanceRefund.findMany({
        where: { supplierAdvanceId: advance.id, status: "ACTIVE" },
        select: { refundNo: true },
      });
      if (lockedRefunds.length > 0)
        throw new Error(
          `ไม่สามารถยกเลิกได้ เนื่องจากถูกอ้างอิงในเอกสารรับคืนเงินมัดจำ: ${lockedRefunds.map((row) => row.refundNo).join(", ")}`,
        );
      await clearCashBankSourceMovements(tx, CashBankSourceType.SUPPLIER_ADVANCE, advance.id,
      );
      await clearDocumentPayments(tx, DocumentPaymentDocType.SUPPLIER_ADVANCE, advance.id,
      );
      await tx.supplierAdvance.update({
        where: { id: advance.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote?.trim() || null,
          amountRemain: 0,
        },
      });
    });

    const afterSnapshot = await getSupplierAdvanceAuditSnapshot(advance.id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "SupplierAdvance",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.advanceNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: parsed.data.cancelNote?.trim() || null },
      });
    }

    revalidatePath("/admin/supplier-advances");
    revalidatePath(`/admin/supplier-advances/${advance.id}`);
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[cancelSupplierAdvance]", error);
    return {
      error: "เกิดข้อผิดพลาด ไม่สามารถยกเลิกเงินมัดจำซัพพลายเออร์ได้",
    };
  }
}
