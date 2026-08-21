"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diffEntity, getAuditActorFromSession, getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generateCustomerAdvanceNo } from "@/lib/doc-number";
import { getDocumentMutationBlockMessage } from "@/lib/document-mutation-guard";
import { AuditAction, CashBankDirection, CashBankSourceType, DocumentPaymentDocType, PaymentMethod, Prisma } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { assertPaymentsMatchTotal, clearDocumentPayments, derivePrimaryAccountId, parseDocumentPaymentRows, replaceDocumentPayments, toCashBankEntries, type DocumentPaymentRow } from "@/lib/document-payments";
import { recalculateCustomerAdvanceAmountRemain } from "@/lib/amount-remain";
import { parseDateOnlyToDate } from "@/lib/th-date";

const schema = z.object({
  customerId: z.string().min(1, "กรุณาเลือกลูกค้า"),
  advanceDate: z.string().min(1, "กรุณาระบุวันที่"),
  totalAmount: z.coerce.number().positive("ยอดเงินมัดจำต้องมากกว่า 0"),
  note: z.string().max(500).optional(),
});

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function resolvePaymentMethod(tx: TxClient, payments: DocumentPaymentRow[]): Promise<PaymentMethod> {
  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({ where: { id: { in: accountIds } }, select: { type: true } });
  if (accounts.length !== accountIds.length) throw new Error("ไม่พบบัญชีรับเงินที่เลือก");
  return accounts.every((account) => account.type === "CASH") ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

function parsePayments(formData: FormData, totalAmount: number) {
  try {
    const payments = parseDocumentPaymentRows(formData.get("payments"));
    if (payments.length === 0) return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" } as const;
    assertPaymentsMatchTotal(payments, totalAmount);
    return { payments } as const;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "รูปแบบช่องทางรับเงินไม่ถูกต้อง" } as const;
  }
}

async function activeReceiptRefs(id: string): Promise<string[]> {
  const rows = await db.receiptItem.findMany({
    where: { customerAdvanceId: id, receipt: { status: "ACTIVE" } },
    select: { receipt: { select: { receiptNo: true } } },
  });
  return [...new Set(rows.map((row) => row.receipt.receiptNo))];
}

async function lockCustomerAdvance(tx: TxClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "CustomerAdvance" WHERE id = ${id} FOR UPDATE`);
}

async function assertNoActiveReceiptRefs(tx: TxClient, id: string, action: "แก้ไข" | "ยกเลิก"): Promise<void> {
  const rows = await tx.receiptItem.findMany({
    where: { customerAdvanceId: id, receipt: { status: "ACTIVE" } },
    select: { receipt: { select: { receiptNo: true } } },
  });
  const refs = [...new Set(rows.map((row) => row.receipt.receiptNo))];
  if (refs.length > 0) {
    throw new Error(`ไม่สามารถ${action}ได้ เนื่องจากถูกใช้ในใบเสร็จ: ${refs.join(", ")}`);
  }
}

async function auditSnapshot(id: string) {
  const [advance, payments] = await Promise.all([
    db.customerAdvance.findUnique({ where: { id }, include: { customer: { select: { code: true, name: true } } } }),
    db.documentPayment.findMany({ where: { docType: DocumentPaymentDocType.CUSTOMER_ADVANCE, docId: id }, orderBy: [{ lineNo: "asc" }, { id: "asc" }], select: { cashBankAccountId: true, amount: true } }),
  ]);
  if (!advance) return null;
  return {
    id: advance.id, advanceNo: advance.advanceNo, advanceDate: advance.advanceDate,
    status: advance.status, customerId: advance.customerId,
    customerRef: advance.customer.code ?? advance.customer.name,
    totalAmount: advance.totalAmount, amountRemain: advance.amountRemain,
    paymentMethod: advance.paymentMethod, cashBankAccountId: advance.cashBankAccountId,
    note: advance.note, cancelNote: advance.cancelNote, cancelledAt: advance.cancelledAt,
    payments: payments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount })),
  };
}

function parseForm(formData: FormData) {
  const parsed = schema.safeParse({
    customerId: formData.get("customerId"), advanceDate: formData.get("advanceDate"),
    totalAmount: formData.get("totalAmount"), note: formData.get("note") || undefined,
  });
  return parsed.success ? { data: parsed.data } as const : { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" } as const;
}

function revalidateAdvancePaths(id?: string) {
  revalidatePath("/admin/customer-advances");
  if (id) revalidatePath(`/admin/customer-advances/${id}`);
  revalidatePath("/admin/receipts");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/cash-bank");
  revalidatePath("/admin/reports");
}

export async function createCustomerAdvance(formData: FormData): Promise<{ success: boolean; advanceNo?: string; advanceId?: string; error?: string }> {
  const session = await requirePermission("customer_advances.create").catch(() => null);
  if (!session?.user?.id) return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };
  const parsed = parseForm(formData);
  if ("error" in parsed) return { success: false, error: parsed.error };
  const paymentResult = parsePayments(formData, parsed.data.totalAmount);
  if ("error" in paymentResult) return { success: false, error: paymentResult.error };
  const advanceDate = parseDateOnlyToDate(parsed.data.advanceDate);
  const advanceNo = await generateCustomerAdvanceNo(advanceDate);
  let advanceId = "";
  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const paymentMethod = await resolvePaymentMethod(tx, paymentResult.payments);
      const advance = await tx.customerAdvance.create({ data: {
        advanceNo, advanceDate, customerId: parsed.data.customerId, userId: session.user.id,
        totalAmount: parsed.data.totalAmount, amountRemain: parsed.data.totalAmount,
        paymentMethod, cashBankAccountId: derivePrimaryAccountId(paymentResult.payments), note: parsed.data.note?.trim() || null,
      } });
      advanceId = advance.id;
      await replaceDocumentPayments(tx, DocumentPaymentDocType.CUSTOMER_ADVANCE, advance.id, CashBankDirection.IN, paymentResult.payments);
      await replaceCashBankSourceMovements(tx, CashBankSourceType.CUSTOMER_ADVANCE, advance.id, toCashBankEntries(paymentResult.payments, {
        txnDate: advanceDate, direction: CashBankDirection.IN, referenceNo: advanceNo, note: parsed.data.note?.trim() || null,
      }));
    });
    const after = await auditSnapshot(advanceId);
    if (after) await safeWriteAuditLog({ ...getAuditActorFromSession(session), ...requestContext, action: AuditAction.CREATE, entityType: "CustomerAdvance", entityId: after.id, entityRef: after.advanceNo, after });
    revalidateAdvancePaths(advanceId);
    return { success: true, advanceNo, advanceId };
  } catch (error) {
    console.error("[createCustomerAdvance]", error);
    return { success: false, error: error instanceof Error ? error.message : "ไม่สามารถบันทึกรับเงินมัดจำลูกค้าได้" };
  }
}

export async function updateCustomerAdvance(id: string, formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("customer_advances.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const existing = await db.customerAdvance.findUnique({ where: { id }, select: { advanceNo: true, status: true } });
  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว" };
  const block = await getDocumentMutationBlockMessage("CustomerAdvance", id, "update");
  if (block) return { error: block };
  const refs = await activeReceiptRefs(id);
  if (refs.length) return { error: `ไม่สามารถแก้ไขได้ เนื่องจากถูกใช้ในใบเสร็จ: ${refs.join(", ")}` };
  const parsed = parseForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  const paymentResult = parsePayments(formData, parsed.data.totalAmount);
  if ("error" in paymentResult) return { error: paymentResult.error };
  try {
    const requestContext = await getRequestContext();
    const before = await auditSnapshot(id);
    const advanceDate = parseDateOnlyToDate(parsed.data.advanceDate);
    await dbTx(async (tx) => {
      await lockCustomerAdvance(tx, id);
      await assertNoActiveReceiptRefs(tx, id, "แก้ไข");
      const paymentMethod = await resolvePaymentMethod(tx, paymentResult.payments);
      await tx.customerAdvance.update({ where: { id }, data: {
        advanceDate, customerId: parsed.data.customerId, totalAmount: parsed.data.totalAmount,
        paymentMethod, cashBankAccountId: derivePrimaryAccountId(paymentResult.payments), note: parsed.data.note?.trim() || null,
      } });
      await recalculateCustomerAdvanceAmountRemain(tx, id);
      await replaceDocumentPayments(tx, DocumentPaymentDocType.CUSTOMER_ADVANCE, id, CashBankDirection.IN, paymentResult.payments);
      await replaceCashBankSourceMovements(tx, CashBankSourceType.CUSTOMER_ADVANCE, id, toCashBankEntries(paymentResult.payments, {
        txnDate: advanceDate, direction: CashBankDirection.IN, referenceNo: existing.advanceNo, note: parsed.data.note?.trim() || null,
      }));
    });
    const after = await auditSnapshot(id);
    if (before && after) { const diff = diffEntity(before, after); await safeWriteAuditLog({ ...getAuditActorFromSession(session), ...requestContext, action: AuditAction.UPDATE, entityType: "CustomerAdvance", entityId: id, entityRef: after.advanceNo, before: diff.before, after: diff.after }); }
    revalidateAdvancePaths(id);
    return { success: true };
  } catch (error) {
    console.error("[updateCustomerAdvance]", error);
    return { error: error instanceof Error ? error.message : "ไม่สามารถแก้ไขรับเงินมัดจำลูกค้าได้" };
  }
}

const cancelSchema = z.object({ advanceId: z.string().min(1), cancelNote: z.string().max(200).optional() });

export async function cancelCustomerAdvance(formData: FormData): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("customer_advances.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = cancelSchema.safeParse({ advanceId: formData.get("advanceId"), cancelNote: formData.get("cancelNote") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const existing = await db.customerAdvance.findUnique({ where: { id: parsed.data.advanceId }, select: { id: true, status: true } });
  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว" };
  const block = await getDocumentMutationBlockMessage("CustomerAdvance", existing.id, "cancel");
  if (block) return { error: block };
  const refs = await activeReceiptRefs(existing.id);
  if (refs.length) return { error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกใช้ในใบเสร็จ: ${refs.join(", ")}` };
  try {
    const requestContext = await getRequestContext();
    const before = await auditSnapshot(existing.id);
    await dbTx(async (tx) => {
      await lockCustomerAdvance(tx, existing.id);
      await assertNoActiveReceiptRefs(tx, existing.id, "ยกเลิก");
      await clearCashBankSourceMovements(tx, CashBankSourceType.CUSTOMER_ADVANCE, existing.id);
      await clearDocumentPayments(tx, DocumentPaymentDocType.CUSTOMER_ADVANCE, existing.id);
      await tx.customerAdvance.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote: parsed.data.cancelNote?.trim() || null, amountRemain: 0 } });
    });
    const after = await auditSnapshot(existing.id);
    if (before && after) { const diff = diffEntity(before, after); await safeWriteAuditLog({ ...getAuditActorFromSession(session), ...requestContext, action: AuditAction.CANCEL, entityType: "CustomerAdvance", entityId: existing.id, entityRef: after.advanceNo, before: diff.before, after: diff.after, meta: { cancelNote: parsed.data.cancelNote?.trim() || null } }); }
    revalidateAdvancePaths(existing.id);
    return { success: true };
  } catch (error) {
    console.error("[cancelCustomerAdvance]", error);
    return { error: error instanceof Error ? error.message : "ไม่สามารถยกเลิกรับเงินมัดจำลูกค้าได้" };
  }
}
