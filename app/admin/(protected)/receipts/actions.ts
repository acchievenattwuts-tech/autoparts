"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { reportCriticalError } from "@/lib/error-reporting";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateReceiptNo } from "@/lib/doc-number";
import { AuditAction, DocumentPaymentDocType, PaymentMethod, Prisma } from "@/lib/generated/prisma";
import { recalculateSaleAmountRemain, recalculateCNAmountRemain, recalculateCustomerAdvanceAmountRemain } from "@/lib/amount-remain";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import {
  assertPaymentsMatchTotal,
  clearDocumentPayments,
  derivePrimaryAccountId,
  parseDocumentPaymentRows,
  replaceDocumentPayments,
  toCashBankEntries,
  type DocumentPaymentRow,
} from "@/lib/document-payments";
import { parseDateOnlyToDate } from "@/lib/th-date";
import {
  getAvailableReceiptDocuments as getAvailableReceiptDocumentsForAR,
  validateReceiptItemsAgainstAvailable as validateReceiptItemsAgainstAvailableForAR,
} from "@/lib/ar-settlement";

type TxClient = Prisma.TransactionClient;

// ─────────────────────────────────────────
// getCreditSalesForCustomer
// ─────────────────────────────────────────

export interface CreditSaleItem {
  id:          string;
  saleNo:      string;  // saleNo for SALE type, cnNo for CN type
  saleDate:    string;  // saleDate or cnDate (ISO)
  netAmount:   number;  // netAmount (SALE) or totalAmount (CN)
  paidAmount:  number;  // amount already collected/applied
  outstanding: number;  // amountRemain
  type:        "SALE" | "CN" | "ADVANCE";
}

export async function getCreditSalesForCustomer(customerId: string): Promise<CreditSaleItem[]> {
  const session = await requireAnyPermission([
    "receipts.view",
    "receipts.create",
    "receipts.update",
  ]).catch(() => null);
  if (!session?.user?.id) return [];

  if (!customerId) return [];

  const [sales, creditNotes, advances] = await Promise.all([
    // Outstanding credit sales
    db.sale.findMany({
      where: {
        customerId,
        paymentType:  "CREDIT_SALE",
        status:       "ACTIVE",
        amountRemain: { gt: 0 },
      },
      orderBy: { saleDate: "asc" },
      select: {
        id:           true,
        saleNo:       true,
        saleDate:     true,
        netAmount:    true,
        amountRemain: true,
      },
    }),
    // Unused CREDIT_DEBT credit notes (these are credits the customer can apply)
    db.creditNote.findMany({
      where: {
        customerId,
        settlementType: "CREDIT_DEBT",
        status:         "ACTIVE",
        amountRemain:   { gt: 0 },
      },
      orderBy: { cnDate: "asc" },
      select: {
        id:           true,
        cnNo:         true,
        cnDate:       true,
        totalAmount:  true,
        amountRemain: true,
      },
    }),
    db.customerAdvance.findMany({
      where: { customerId, status: "ACTIVE", amountRemain: { gt: 0 } },
      orderBy: { advanceDate: "asc" },
      select: { id: true, advanceNo: true, advanceDate: true, totalAmount: true, amountRemain: true },
    }),
  ]);

  const saleItems: CreditSaleItem[] = sales.map((s) => ({
    id:          s.id,
    saleNo:      s.saleNo,
    saleDate:    s.saleDate.toISOString(),
    netAmount:   Number(s.netAmount),
    paidAmount:  Number(s.netAmount) - Number(s.amountRemain),
    outstanding: Number(s.amountRemain),
    type:        "SALE",
  }));

  const cnItems: CreditSaleItem[] = creditNotes.map((cn) => ({
    id:          cn.id,
    saleNo:      cn.cnNo,
    saleDate:    cn.cnDate.toISOString(),
    netAmount:   Number(cn.totalAmount),
    paidAmount:  Number(cn.totalAmount) - Number(cn.amountRemain),
    outstanding: Number(cn.amountRemain),
    type:        "CN",
  }));

  const advanceItems: CreditSaleItem[] = advances.map((advance) => ({
    id: advance.id, saleNo: advance.advanceNo, saleDate: advance.advanceDate.toISOString(),
    netAmount: Number(advance.totalAmount), paidAmount: Number(advance.totalAmount) - Number(advance.amountRemain),
    outstanding: Number(advance.amountRemain), type: "ADVANCE",
  }));

  return [...saleItems, ...cnItems, ...advanceItems];
}

// ─────────────────────────────────────────
// createReceipt
// ─────────────────────────────────────────

const receiptItemSchema = z
  .object({
    saleId: z.string().optional(),
    cnId: z.string().optional(),
    customerAdvanceId: z.string().optional(),
    paidAmount: z.coerce.number().positive("ยอดที่รับชำระต้องมากกว่า 0"),
  })
  .superRefine((data, ctx) => {
    const refCount = [data.saleId, data.cnId, data.customerAdvanceId].filter(Boolean).length;
    if (refCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "แต่ละรายการต้องอ้างอิงเอกสารได้เพียง 1 ประเภท",
      });
    }
  });

const receiptSchema = z.object({
  customerId:    z.string().optional(),
  customerName:  z.string().max(100).optional(),
  receiptDate:   z.string().min(1),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  note:          z.string().max(500).optional(),
  items:         z.array(receiptItemSchema).min(1, "ต้องมีรายการชำระอย่างน้อย 1 รายการ"),
});

type ParsedReceipt = z.infer<typeof receiptSchema> & { payments: DocumentPaymentRow[] };

function parseReceiptForm(
  formData: FormData,
): { success: true; data: ParsedReceipt } | { success: false; error: string } {
  try {
    const parsed = receiptSchema.parse({
      customerId: formData.get("customerId") ?? undefined,
      customerName: formData.get("customerName") ?? undefined,
      receiptDate: formData.get("receiptDate"),
      paymentMethod: formData.get("paymentMethod") ?? undefined,
      note: formData.get("note") ?? undefined,
      items: JSON.parse((formData.get("items") as string) ?? "[]"),
    });
    const payments = parseDocumentPaymentRows(formData.get("payments"));
    return { success: true, data: { ...parsed, payments } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    }
    return { success: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
}

function calculateReceiptTotalAmount(items: ParsedReceipt["items"]): number {
  const total = items.reduce((sum, item) => {
    if (item.cnId || item.customerAdvanceId) return sum - item.paidAmount;
    return sum + item.paidAmount;
  }, 0);
  return Math.round(total * 100) / 100;
}

async function lockCustomerAdvancesForReceipt(tx: TxClient, advanceIds: string[]): Promise<void> {
  const ids = [...new Set(advanceIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT id
    FROM "CustomerAdvance"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `);
}

function collectAffectedReceiptIds(items: Array<{
  saleId?: string | null | undefined;
  cnId?: string | null | undefined;
  customerAdvanceId?: string | null | undefined;
}>): { saleIds: string[]; cnIds: string[]; advanceIds: string[] } {
  return {
    saleIds: [...new Set(items.map((item) => item.saleId).filter((id): id is string => !!id))],
    cnIds: [...new Set(items.map((item) => item.cnId).filter((id): id is string => !!id))],
    advanceIds: [...new Set(items.map((item) => item.customerAdvanceId).filter((id): id is string => !!id))],
  };
}

async function recalculateAffectedReceiptDocuments(
  tx: TxClient,
  affectedIds: ReturnType<typeof collectAffectedReceiptIds>,
): Promise<void> {
  for (const saleId of affectedIds.saleIds) {
    await recalculateSaleAmountRemain(tx, saleId);
  }
  for (const cnId of affectedIds.cnIds) {
    await recalculateCNAmountRemain(tx, cnId);
  }
  for (const advanceId of affectedIds.advanceIds) {
    await recalculateCustomerAdvanceAmountRemain(tx, advanceId);
  }
}

async function resolveReceiptPaymentMethod(
  tx: TxClient,
  payments: DocumentPaymentRow[],
  totalAmount: number,
): Promise<PaymentMethod> {
  if (payments.length === 0) {
    return totalAmount > 0 ? PaymentMethod.TRANSFER : PaymentMethod.CREDIT;
  }

  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { type: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("ไม่พบบัญชีรับเงิน");
  }

  // Mixed channels: label the receipt as a transfer unless every channel is cash.
  const allCash = accounts.every((account) => account.type === "CASH");
  return allCash ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

async function getReceiptSignerSnapshot(
  tx: TxClient,
  userId: string,
  signedAt: Date,
): Promise<{
  signerName: string | null;
  signerSignatureUrl: string | null;
  signedAt: Date | null;
}> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, signatureUrl: true },
  });

  return {
    signerName: user?.name ?? null,
    signerSignatureUrl: user?.signatureUrl ?? null,
    signedAt: user?.name ? signedAt : null,
  };
}

async function getReceiptAuditSnapshot(receiptId: string) {
  const [receipt, payments] = await Promise.all([
    db.receipt.findUnique({
    where: { id: receiptId },
    include: {
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: {
          saleId: true,
          cnId: true,
          customerAdvanceId: true,
          paidAmount: true,
          sale: {
            select: {
              saleNo: true,
            },
          },
          creditNote: {
            select: {
              cnNo: true,
            },
          },
          customerAdvance: { select: { advanceNo: true } },
        },
      },
    },
  }),
    db.documentPayment.findMany({
      where: { docType: DocumentPaymentDocType.RECEIPT, docId: receiptId },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

  if (!receipt) return null;

  return {
    id: receipt.id,
    receiptNo: receipt.receiptNo,
    receiptDate: receipt.receiptDate,
    status: receipt.status,
    customerId: receipt.customerId,
    customerName: receipt.customerName,
    totalAmount: receipt.totalAmount,
    paymentMethod: receipt.paymentMethod,
    cashBankAccountId: receipt.cashBankAccountId,
    note: receipt.note,
    cancelNote: receipt.cancelNote,
    cancelledAt: receipt.cancelledAt,
    items: receipt.items.map((item) => ({
      saleId: item.saleId,
      saleNo: item.sale?.saleNo ?? null,
      cnId: item.cnId,
      cnNo: item.creditNote?.cnNo ?? null,
      customerAdvanceId: item.customerAdvanceId,
      customerAdvanceNo: item.customerAdvance?.advanceNo ?? null,
      paidAmount: item.paidAmount,
    })),
    payments: payments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: payment.amount,
    })),
  };
}

export async function createReceipt(
  formData: FormData,
): Promise<{ success: boolean; receiptNo?: string; receiptId?: string | null; error?: string }> {
  const session = await requirePermission("receipts.create").catch(() => null);
  if (!session?.user?.id) {
    return { success: false, error: "กรุณาเข้าสู่ระบบก่อน" };
  }

  const parsedResult = parseReceiptForm(formData);
  if (!parsedResult.success) {
    return { success: false, error: parsedResult.error };
  }
  const parsed = parsedResult.data;

  try {
    const docDate   = parseDateOnlyToDate(parsed.receiptDate);
    const receiptNo = await generateReceiptNo(docDate);
    let createdReceiptId = "";

    // Sale items add to total; CN items are credits that reduce the total
    const totalAmount = calculateReceiptTotalAmount(parsed.items);
    if (totalAmount < 0) {
      return { success: false, error: "ยอดเครดิต CN และเงินมัดจำที่เลือกมากกว่ายอดใบขายเชื่อ" };
    }
    // Only positive net totals move real cash and require payment channels.
    const payments = totalAmount > 0 ? parsed.payments : [];
    if (totalAmount > 0) {
      if (payments.length === 0) {
        return { success: false, error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
      }
      try {
        assertPaymentsMatchTotal(payments, totalAmount);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "ยอดช่องทางรับเงินไม่ถูกต้อง" };
      }
    }

    const primaryAccountId = derivePrimaryAccountId(payments);
    const affectedIds = collectAffectedReceiptIds(parsed.items);
    const requestContext = await getRequestContext();

    await dbTx(async (tx) => {
      await lockCustomerAdvancesForReceipt(tx, affectedIds.advanceIds);
      const available = await getAvailableReceiptDocumentsForAR(tx, parsed.customerId ?? "");
      const validationError = validateReceiptItemsAgainstAvailableForAR(parsed.customerId, parsed.items, available);
      if (validationError) throw new Error(validationError);

      const signerSnapshot = await getReceiptSignerSnapshot(tx, session.user!.id, docDate);
      const resolvedPaymentMethod = await resolveReceiptPaymentMethod(tx, payments, totalAmount);

      const receipt = await tx.receipt.create({
        data: {
          receiptNo,
          receiptDate:   docDate,
          customerId:    parsed.customerId || null,
          customerName:  parsed.customerName || null,
          userId:        session.user!.id,
          signerName: signerSnapshot.signerName,
          signerSignatureUrl: signerSnapshot.signerSignatureUrl,
          signedAt: signerSnapshot.signedAt,
          totalAmount,
          paymentMethod: resolvedPaymentMethod,
          cashBankAccountId: primaryAccountId,
          note:          parsed.note || null,
        },
      });
      createdReceiptId = receipt.id;

      await tx.receiptItem.createMany({
        data: parsed.items.map((item, idx) => ({
          receiptId:  receipt.id,
          lineNo:     idx + 1,
          saleId:     item.saleId ?? null,
          cnId:       item.cnId ?? null,
          customerAdvanceId: item.customerAdvanceId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      await recalculateAffectedReceiptDocuments(tx, affectedIds);

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.RECEIPT,
        receipt.id,
        CashBankDirection.IN,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.RECEIPT,
        receipt.id,
        toCashBankEntries(payments, {
          txnDate: docDate,
          direction: CashBankDirection.IN,
          referenceNo: receiptNo,
          note: parsed.note || null,
        }),
      );
    });

    const afterSnapshot = createdReceiptId
      ? await getReceiptAuditSnapshot(createdReceiptId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Receipt",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.receiptNo,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/receipts");
    revalidatePath("/admin/customers");
    revalidatePath("/admin/customer-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");

    return { success: true, receiptNo, receiptId: createdReceiptId };
  } catch (err) {
    await reportCriticalError(err, { scope: "receipts.create" });
    return {
      success: false,
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด ไม่สามารถบันทึกใบเสร็จได้",
    };
  }
}

const cancelReceiptSchema = z.object({
  receiptId:  z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelReceipt(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("receipts.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReceiptSchema.safeParse({
    receiptId:  formData.get("receiptId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { receiptId, cancelNote } = parsed.data;

  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    include: { items: { orderBy: { lineNo: "asc" }, select: { saleId: true, cnId: true, customerAdvanceId: true } } },
  });
  if (!receipt)                        return { error: "ไม่พบเอกสาร" };
  if (receipt.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const affectedSaleIds = [...new Set(receipt.items.map((i) => i.saleId).filter((id): id is string => id !== null))];
  const affectedCnIds   = [...new Set(receipt.items.map((i) => i.cnId).filter((id): id is string => id !== null))];
  const affectedAdvanceIds = [...new Set(receipt.items.map((i) => i.customerAdvanceId).filter((id): id is string => id !== null))];

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getReceiptAuditSnapshot(receiptId);
    await dbTx(async (tx) => {
      await lockCustomerAdvancesForReceipt(tx, affectedAdvanceIds);
      await clearCashBankSourceMovements(tx, CashBankSourceType.RECEIPT, receiptId);
      await clearDocumentPayments(tx, DocumentPaymentDocType.RECEIPT, receiptId);
      await tx.receipt.update({
        where: { id: receiptId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote },
      });
      for (const saleId of affectedSaleIds) {
        await recalculateSaleAmountRemain(tx, saleId);
      }
      for (const cnId of affectedCnIds) {
        await recalculateCNAmountRemain(tx, cnId);
      }
      for (const advanceId of affectedAdvanceIds) {
        await recalculateCustomerAdvanceAmountRemain(tx, advanceId);
      }
    });

    const afterSnapshot = await getReceiptAuditSnapshot(receiptId);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "Receipt",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.receiptNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: cancelNote ?? null },
      });
    }

    revalidatePath("/admin/receipts");
    revalidatePath("/admin/customer-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "receipts.cancel" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateReceipt
// ─────────────────────────────────────────

export async function updateReceipt(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("receipts.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.receipt.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, signatureUrl: true } },
      items: { orderBy: { lineNo: "asc" }, select: { saleId: true, cnId: true, customerAdvanceId: true } },
    },
  });
  if (!existing)                       return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  const parsedResult = parseReceiptForm(formData);
  if (!parsedResult.success) return { error: parsedResult.error };
  const parsed = parsedResult.data;

  const docDate     = parseDateOnlyToDate(parsed.receiptDate);
  const totalAmount = calculateReceiptTotalAmount(parsed.items);
  if (totalAmount < 0) return { error: "ยอดเครดิต CN และเงินมัดจำที่เลือกมากกว่ายอดใบขายเชื่อ" };
  const payments = totalAmount > 0 ? parsed.payments : [];
  if (totalAmount > 0) {
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
    }
    try {
      assertPaymentsMatchTotal(payments, totalAmount);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "ยอดช่องทางรับเงินไม่ถูกต้อง" };
    }
  }

  const primaryAccountId = derivePrimaryAccountId(payments);
  const oldAffectedIds = collectAffectedReceiptIds(existing.items);
  const newAffectedIds = collectAffectedReceiptIds(parsed.items);
  const allAffectedIds = {
    saleIds: [...new Set([...oldAffectedIds.saleIds, ...newAffectedIds.saleIds])],
    cnIds: [...new Set([...oldAffectedIds.cnIds, ...newAffectedIds.cnIds])],
    advanceIds: [...new Set([...oldAffectedIds.advanceIds, ...newAffectedIds.advanceIds])],
  };

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getReceiptAuditSnapshot(id);
    await dbTx(async (tx) => {
      await lockCustomerAdvancesForReceipt(tx, allAffectedIds.advanceIds);
      const available = await getAvailableReceiptDocumentsForAR(tx, parsed.customerId ?? "", id);
      const validationError = validateReceiptItemsAgainstAvailableForAR(parsed.customerId, parsed.items, available);
      if (validationError) throw new Error(validationError);

      const fallbackSignerName = existing.signerName ?? existing.user?.name ?? null;
      const fallbackSignerSignatureUrl =
        existing.signerSignatureUrl ?? existing.user?.signatureUrl ?? null;
      const fallbackSignedAt = existing.signedAt ?? (fallbackSignerName ? docDate : null);

      const resolvedPaymentMethod = await resolveReceiptPaymentMethod(tx, payments, totalAmount);

      // 1. Delete old receipt items
      await tx.receiptItem.deleteMany({ where: { receiptId: id } });

      // 2. Update header
      await tx.receipt.update({
        where: { id },
        data: {
          receiptDate:   docDate,
          customerId:    parsed.customerId || null,
          customerName:  parsed.customerName || null,
          signerName: fallbackSignerName,
          signerSignatureUrl: fallbackSignerSignatureUrl,
          signedAt: fallbackSignedAt,
          totalAmount,
          paymentMethod: resolvedPaymentMethod,
          cashBankAccountId: primaryAccountId,
          note:          parsed.note || null,
        },
      });

      // 3. Re-create receipt items
      await tx.receiptItem.createMany({
        data: parsed.items.map((item, idx) => ({
          receiptId:  id,
          lineNo:     idx + 1,
          saleId:     item.saleId ?? null,
          cnId:       item.cnId ?? null,
          customerAdvanceId: item.customerAdvanceId ?? null,
          paidAmount: item.paidAmount,
        })),
      });

      // 4. Recalculate amountRemain for all affected sales and CNs
      await recalculateAffectedReceiptDocuments(tx, allAffectedIds);

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.RECEIPT,
        id,
        CashBankDirection.IN,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.RECEIPT,
        id,
        toCashBankEntries(payments, {
          txnDate: docDate,
          direction: CashBankDirection.IN,
          referenceNo: existing.receiptNo,
          note: parsed.note || null,
        }),
      );
    });

    const afterSnapshot = await getReceiptAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Receipt",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.receiptNo,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/receipts");
    revalidatePath(`/admin/receipts/${id}`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/customer-advances");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "receipts.update" });
    return {
      error: err instanceof Error ? err.message : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
    };
  }
}
