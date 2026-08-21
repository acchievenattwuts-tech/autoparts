"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import {
  recalculateCustomerAdvanceAmountRemain,
  recalculateSupplierAdvanceAmountRemain,
} from "@/lib/amount-remain";
import {
  clearCashBankSourceMovements,
  replaceCashBankSourceMovements,
} from "@/lib/cash-bank";
import { db, dbTx } from "@/lib/db";
import {
  clearDocumentPayments,
  derivePrimaryAccountId,
  parseDocumentPaymentRows,
  replaceDocumentPayments,
  assertPaymentsMatchTotal,
  toCashBankEntries,
  type DocumentPaymentRow,
} from "@/lib/document-payments";
import {
  generateCustomerAdvanceRefundNo,
  generateSupplierAdvanceRefundNo,
} from "@/lib/doc-number";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  DocumentPaymentDocType,
  PaymentMethod,
  Prisma,
} from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { parseDateOnlyToDate } from "@/lib/th-date";

type RefundSide = "CUSTOMER" | "SUPPLIER";
type TxClient = Prisma.TransactionClient;

const refundSchema = z.object({
  sourceAdvanceId: z.string().min(1, "กรุณาเลือกเอกสารมัดจำต้นทาง"),
  refundDate: z.string().min(1, "กรุณาระบุวันที่"),
  refundAmount: z.coerce.number().positive("ยอดคืนต้องมากกว่า 0"),
  note: z.string().max(500).optional(),
});

const cancelSchema = z.object({
  refundId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

function parseRefundForm(formData: FormData) {
  return refundSchema.safeParse({
    sourceAdvanceId: formData.get("sourceAdvanceId"),
    refundDate: formData.get("refundDate"),
    refundAmount: formData.get("refundAmount"),
    note: formData.get("note") || undefined,
  });
}

function parsePayments(
  formData: FormData,
  amount: number,
): DocumentPaymentRow[] {
  const rows = parseDocumentPaymentRows(formData.get("payments"));
  if (rows.length === 0)
    throw new Error("กรุณาระบุช่องทางรับ/จ่ายเงินอย่างน้อย 1 ช่องทาง");
  assertPaymentsMatchTotal(rows, amount);
  return rows;
}

async function resolvePaymentMethod(
  tx: TxClient,
  payments: DocumentPaymentRow[],
): Promise<PaymentMethod> {
  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { type: true },
  });
  if (accounts.length !== accountIds.length)
    throw new Error("ไม่พบบัญชีเงินสด/ธนาคารที่เลือก");
  return accounts.every((account) => account.type === "CASH")
    ? PaymentMethod.CASH
    : PaymentMethod.TRANSFER;
}

async function lockSource(
  tx: TxClient,
  side: RefundSide,
  sourceId: string,
): Promise<void> {
  if (side === "CUSTOMER") {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "CustomerAdvance" WHERE id = ${sourceId} FOR UPDATE`,
    );
  } else {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "SupplierAdvance" WHERE id = ${sourceId} FOR UPDATE`,
    );
  }
}

async function lockRefund(
  tx: TxClient,
  side: RefundSide,
  refundId: string,
): Promise<void> {
  if (side === "CUSTOMER") {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "CustomerAdvanceRefund" WHERE id = ${refundId} FOR UPDATE`,
    );
  } else {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "SupplierAdvanceRefund" WHERE id = ${refundId} FOR UPDATE`,
    );
  }
}

function sideConfig(side: RefundSide) {
  return side === "CUSTOMER"
    ? {
        permissionPrefix: "customer_advance_refunds" as const,
        entityType: "CustomerAdvanceRefund",
        listPath: "/admin/customer-advance-refunds",
        sourcePath: "/admin/customer-advances",
        sourceType: CashBankSourceType.CUSTOMER_ADVANCE_REFUND,
        paymentDocType: DocumentPaymentDocType.CUSTOMER_ADVANCE_REFUND,
        direction: CashBankDirection.OUT,
        createError: "ไม่สามารถบันทึกคืนเงินมัดจำลูกค้าได้",
      }
    : {
        permissionPrefix: "supplier_advance_refunds" as const,
        entityType: "SupplierAdvanceRefund",
        listPath: "/admin/supplier-advance-refunds",
        sourcePath: "/admin/supplier-advances",
        sourceType: CashBankSourceType.SUPPLIER_ADVANCE_REFUND,
        paymentDocType: DocumentPaymentDocType.SUPPLIER_ADVANCE_REFUND,
        direction: CashBankDirection.IN,
        createError: "ไม่สามารถบันทึกรับคืนเงินมัดจำซัพพลายเออร์ได้",
      };
}

async function refundSnapshot(side: RefundSide, id: string) {
  if (side === "CUSTOMER") {
    const [refund, payments] = await Promise.all([
      db.customerAdvanceRefund.findUnique({
        where: { id },
        include: {
          customerAdvance: {
            include: { customer: { select: { code: true, name: true } } },
          },
        },
      }),
      db.documentPayment.findMany({
        where: {
          docType: DocumentPaymentDocType.CUSTOMER_ADVANCE_REFUND,
          docId: id,
        },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: { cashBankAccountId: true, amount: true },
      }),
    ]);
    if (!refund) return null;
    return {
      id: refund.id,
      refundNo: refund.refundNo,
      refundDate: refund.refundDate,
      status: refund.status,
      sourceAdvanceId: refund.customerAdvanceId,
      sourceAdvanceNo: refund.customerAdvance.advanceNo,
      partyRef:
        refund.customerAdvance.customer.code ??
        refund.customerAdvance.customer.name,
      refundAmount: refund.refundAmount,
      paymentMethod: refund.paymentMethod,
      cashBankAccountId: refund.cashBankAccountId,
      note: refund.note,
      cancelNote: refund.cancelNote,
      cancelledAt: refund.cancelledAt,
      payments,
    };
  }
  const [refund, payments] = await Promise.all([
    db.supplierAdvanceRefund.findUnique({
      where: { id },
      include: {
        supplierAdvance: {
          include: { supplier: { select: { code: true, name: true } } },
        },
      },
    }),
    db.documentPayment.findMany({
      where: {
        docType: DocumentPaymentDocType.SUPPLIER_ADVANCE_REFUND,
        docId: id,
      },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);
  if (!refund) return null;
  return {
    id: refund.id,
    refundNo: refund.refundNo,
    refundDate: refund.refundDate,
    status: refund.status,
    sourceAdvanceId: refund.supplierAdvanceId,
    sourceAdvanceNo: refund.supplierAdvance.advanceNo,
    partyRef:
      refund.supplierAdvance.supplier.code ??
      refund.supplierAdvance.supplier.name,
    refundAmount: refund.refundAmount,
    paymentMethod: refund.paymentMethod,
    cashBankAccountId: refund.cashBankAccountId,
    note: refund.note,
    cancelNote: refund.cancelNote,
    cancelledAt: refund.cancelledAt,
    payments,
  };
}

function revalidateRefundPaths(
  side: RefundSide,
  refundId: string,
  sourceId: string,
): void {
  const config = sideConfig(side);
  revalidatePath(config.listPath);
  revalidatePath(`${config.listPath}/${refundId}`);
  revalidatePath(`${config.sourcePath}/${sourceId}`);
  revalidatePath(config.sourcePath);
  revalidatePath("/admin/cash-bank");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/reports/line-daily-summary");
}

async function createRefund(side: RefundSide, formData: FormData) {
  const config = sideConfig(side);
  const session = await requirePermission(
    `${config.permissionPrefix}.create`,
  ).catch(() => null);
  if (!session?.user?.id)
    return { success: false, error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = parseRefundForm(formData);
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง",
    };
  let payments: DocumentPaymentRow[];
  try {
    payments = parsePayments(formData, parsed.data.refundAmount);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "ข้อมูลช่องทางรับ/จ่ายไม่ถูกต้อง",
    };
  }
  const refundDate = parseDateOnlyToDate(parsed.data.refundDate);
  const refundNo =
    side === "CUSTOMER"
      ? await generateCustomerAdvanceRefundNo(refundDate)
      : await generateSupplierAdvanceRefundNo(refundDate);
  let createdId = "";
  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      await lockSource(tx, side, parsed.data.sourceAdvanceId);
      const source =
        side === "CUSTOMER"
          ? await tx.customerAdvance.findUnique({
              where: { id: parsed.data.sourceAdvanceId },
              select: { status: true, amountRemain: true },
            })
          : await tx.supplierAdvance.findUnique({
              where: { id: parsed.data.sourceAdvanceId },
              select: { status: true, amountRemain: true },
            });
      if (!source) throw new Error("ไม่พบเอกสารมัดจำต้นทาง");
      if (source.status !== "ACTIVE")
        throw new Error("เอกสารมัดจำต้นทางถูกยกเลิกแล้ว");
      if (parsed.data.refundAmount - Number(source.amountRemain) > 0.005) {
        throw new Error(
          `ยอดคืนต้องไม่เกินยอดคงเหลือ ${Number(source.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`,
        );
      }
      const paymentMethod = await resolvePaymentMethod(tx, payments);
      const common = {
        refundNo,
        refundDate,
        userId: session.user.id,
        refundAmount: parsed.data.refundAmount,
        paymentMethod,
        note: parsed.data.note?.trim() || null,
        cashBankAccountId: derivePrimaryAccountId(payments),
      };
      const created =
        side === "CUSTOMER"
          ? await tx.customerAdvanceRefund.create({
              data: {
                ...common,
                customerAdvanceId: parsed.data.sourceAdvanceId,
              },
            })
          : await tx.supplierAdvanceRefund.create({
              data: {
                ...common,
                supplierAdvanceId: parsed.data.sourceAdvanceId,
              },
            });
      createdId = created.id;
      await replaceDocumentPayments(
        tx,
        config.paymentDocType,
        created.id,
        config.direction,
        payments,
      );
      await replaceCashBankSourceMovements(
        tx,
        config.sourceType,
        created.id,
        toCashBankEntries(payments, {
          txnDate: refundDate,
          direction: config.direction,
          referenceNo: refundNo,
          note: parsed.data.note?.trim() || null,
        }),
      );
      if (side === "CUSTOMER")
        await recalculateCustomerAdvanceAmountRemain(
          tx,
          parsed.data.sourceAdvanceId,
        );
      else
        await recalculateSupplierAdvanceAmountRemain(
          tx,
          parsed.data.sourceAdvanceId,
        );
    });
    const after = await refundSnapshot(side, createdId);
    if (after)
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: config.entityType,
        entityId: after.id,
        entityRef: after.refundNo,
        after,
      });
    revalidateRefundPaths(side, createdId, parsed.data.sourceAdvanceId);
    return { success: true, refundId: createdId, refundNo };
  } catch (error) {
    console.error(`[create${config.entityType}]`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : config.createError,
    };
  }
}

async function updateRefund(side: RefundSide, id: string, formData: FormData) {
  const config = sideConfig(side);
  const session = await requirePermission(
    `${config.permissionPrefix}.update`,
  ).catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = parseRefundForm(formData);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  let payments: DocumentPaymentRow[];
  try {
    payments = parsePayments(formData, parsed.data.refundAmount);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "ข้อมูลช่องทางรับ/จ่ายไม่ถูกต้อง",
    };
  }
  const initial =
    side === "CUSTOMER"
      ? await db.customerAdvanceRefund.findUnique({
          where: { id },
          select: { customerAdvanceId: true, status: true, refundNo: true },
        })
      : await db.supplierAdvanceRefund.findUnique({
          where: { id },
          select: { supplierAdvanceId: true, status: true, refundNo: true },
        });
  if (!initial) return { error: "ไม่พบเอกสาร" };
  if (initial.status === "CANCELLED")
    return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  const sourceId =
    "customerAdvanceId" in initial
      ? initial.customerAdvanceId
      : initial.supplierAdvanceId;
  if (parsed.data.sourceAdvanceId !== sourceId)
    return { error: "ไม่สามารถเปลี่ยนเอกสารมัดจำต้นทางได้" };
  const refundDate = parseDateOnlyToDate(parsed.data.refundDate);
  try {
    const requestContext = await getRequestContext();
    const before = await refundSnapshot(side, id);
    await dbTx(async (tx) => {
      await lockSource(tx, side, sourceId);
      await lockRefund(tx, side, id);
      const refund =
        side === "CUSTOMER"
          ? await tx.customerAdvanceRefund.findUnique({
              where: { id },
              select: {
                status: true,
                refundAmount: true,
                customerAdvanceId: true,
              },
            })
          : await tx.supplierAdvanceRefund.findUnique({
              where: { id },
              select: {
                status: true,
                refundAmount: true,
                supplierAdvanceId: true,
              },
            });
      if (!refund || refund.status !== "ACTIVE")
        throw new Error("เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้");
      const lockedSourceId =
        "customerAdvanceId" in refund
          ? refund.customerAdvanceId
          : refund.supplierAdvanceId;
      if (lockedSourceId !== sourceId)
        throw new Error("เอกสารมัดจำต้นทางไม่ตรงกับข้อมูลเดิม");
      const source =
        side === "CUSTOMER"
          ? await tx.customerAdvance.findUnique({
              where: { id: sourceId },
              select: { status: true, amountRemain: true },
            })
          : await tx.supplierAdvance.findUnique({
              where: { id: sourceId },
              select: { status: true, amountRemain: true },
            });
      if (!source || source.status !== "ACTIVE")
        throw new Error("เอกสารมัดจำต้นทางไม่พร้อมใช้งาน");
      const maxRefund =
        Number(source.amountRemain) + Number(refund.refundAmount);
      if (parsed.data.refundAmount - maxRefund > 0.005) {
        throw new Error(
          `ยอดคืนต้องไม่เกิน ${maxRefund.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`,
        );
      }
      const paymentMethod = await resolvePaymentMethod(tx, payments);
      const data = {
        refundDate,
        refundAmount: parsed.data.refundAmount,
        paymentMethod,
        note: parsed.data.note?.trim() || null,
        cashBankAccountId: derivePrimaryAccountId(payments),
      };
      if (side === "CUSTOMER")
        await tx.customerAdvanceRefund.update({ where: { id }, data });
      else await tx.supplierAdvanceRefund.update({ where: { id }, data });
      await replaceDocumentPayments(
        tx,
        config.paymentDocType,
        id,
        config.direction,
        payments,
      );
      await replaceCashBankSourceMovements(
        tx,
        config.sourceType,
        id,
        toCashBankEntries(payments, {
          txnDate: refundDate,
          direction: config.direction,
          referenceNo: initial.refundNo,
          note: parsed.data.note?.trim() || null,
        }),
      );
      if (side === "CUSTOMER")
        await recalculateCustomerAdvanceAmountRemain(tx, sourceId);
      else await recalculateSupplierAdvanceAmountRemain(tx, sourceId);
    });
    const after = await refundSnapshot(side, id);
    if (before && after) {
      const diff = diffEntity(before, after);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: config.entityType,
        entityId: id,
        entityRef: after.refundNo,
        before: diff.before,
        after: diff.after,
      });
    }
    revalidateRefundPaths(side, id, sourceId);
    return { success: true };
  } catch (error) {
    console.error(`[update${config.entityType}]`, error);
    return {
      error: error instanceof Error ? error.message : "ไม่สามารถแก้ไขเอกสารได้",
    };
  }
}

async function cancelRefund(side: RefundSide, formData: FormData) {
  const config = sideConfig(side);
  const session = await requirePermission(
    `${config.permissionPrefix}.cancel`,
  ).catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = cancelSchema.safeParse({
    refundId: formData.get("refundId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const initial =
    side === "CUSTOMER"
      ? await db.customerAdvanceRefund.findUnique({
          where: { id: parsed.data.refundId },
          select: { customerAdvanceId: true, status: true },
        })
      : await db.supplierAdvanceRefund.findUnique({
          where: { id: parsed.data.refundId },
          select: { supplierAdvanceId: true, status: true },
        });
  if (!initial) return { error: "ไม่พบเอกสาร" };
  if (initial.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว" };
  const sourceId =
    "customerAdvanceId" in initial
      ? initial.customerAdvanceId
      : initial.supplierAdvanceId;
  try {
    const requestContext = await getRequestContext();
    const before = await refundSnapshot(side, parsed.data.refundId);
    await dbTx(async (tx) => {
      await lockSource(tx, side, sourceId);
      await lockRefund(tx, side, parsed.data.refundId);
      const lockedRefund =
        side === "CUSTOMER"
          ? await tx.customerAdvanceRefund.findUnique({
              where: { id: parsed.data.refundId },
              select: { status: true, customerAdvanceId: true },
            })
          : await tx.supplierAdvanceRefund.findUnique({
              where: { id: parsed.data.refundId },
              select: { status: true, supplierAdvanceId: true },
            });
      if (!lockedRefund || lockedRefund.status !== "ACTIVE")
        throw new Error("เอกสารถูกยกเลิกแล้ว");
      const lockedSourceId =
        "customerAdvanceId" in lockedRefund
          ? lockedRefund.customerAdvanceId
          : lockedRefund.supplierAdvanceId;
      if (lockedSourceId !== sourceId)
        throw new Error("เอกสารมัดจำต้นทางไม่ตรงกับข้อมูลเดิม");
      await clearCashBankSourceMovements(
        tx,
        config.sourceType,
        parsed.data.refundId,
      );
      await clearDocumentPayments(
        tx,
        config.paymentDocType,
        parsed.data.refundId,
      );
      const data = {
        status: "CANCELLED" as const,
        cancelledAt: new Date(),
        cancelNote: parsed.data.cancelNote?.trim() || null,
      };
      if (side === "CUSTOMER")
        await tx.customerAdvanceRefund.update({
          where: { id: parsed.data.refundId },
          data,
        });
      else
        await tx.supplierAdvanceRefund.update({
          where: { id: parsed.data.refundId },
          data,
        });
      if (side === "CUSTOMER")
        await recalculateCustomerAdvanceAmountRemain(tx, sourceId);
      else await recalculateSupplierAdvanceAmountRemain(tx, sourceId);
    });
    const after = await refundSnapshot(side, parsed.data.refundId);
    if (before && after) {
      const diff = diffEntity(before, after);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: config.entityType,
        entityId: parsed.data.refundId,
        entityRef: after.refundNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: parsed.data.cancelNote?.trim() || null },
      });
    }
    revalidateRefundPaths(side, parsed.data.refundId, sourceId);
    return { success: true };
  } catch (error) {
    console.error(`[cancel${config.entityType}]`, error);
    return {
      error:
        error instanceof Error ? error.message : "ไม่สามารถยกเลิกเอกสารได้",
    };
  }
}

export async function createCustomerAdvanceRefund(formData: FormData) {
  return createRefund("CUSTOMER", formData);
}
export async function updateCustomerAdvanceRefund(
  id: string,
  formData: FormData,
) {
  return updateRefund("CUSTOMER", id, formData);
}
export async function cancelCustomerAdvanceRefund(formData: FormData) {
  return cancelRefund("CUSTOMER", formData);
}
export async function createSupplierAdvanceRefund(formData: FormData) {
  return createRefund("SUPPLIER", formData);
}
export async function updateSupplierAdvanceRefund(
  id: string,
  formData: FormData,
) {
  return updateRefund("SUPPLIER", id, formData);
}
export async function cancelSupplierAdvanceRefund(formData: FormData) {
  return cancelRefund("SUPPLIER", formData);
}
