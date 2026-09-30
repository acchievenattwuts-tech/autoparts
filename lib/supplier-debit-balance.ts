import {
  CashBankDirection, CashBankSourceType, DocumentPaymentDocType, Prisma, PurchaseReturnRefundMethod, PurchaseReturnSettlementType,
} from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { clearDocumentPayments, replaceDocumentPayments, toCashBankEntries } from "@/lib/document-payments";

/**
 * Outstanding balances of a supplier DN and its "ปรับยอด DN" adjustments (R5-D / ก3, owner approved 2026-09-30).
 *
 * An adjustment is a SupplierDebitNote dated today whose adjustsDebitNoteId points at the DN it corrects (the parent).
 * - A positive adjustment (netAmount > 0) is its own payable: amountRemain = net - active payments.
 * - A negative adjustment (netAmount < 0) first reduces the parent's outstanding balance, never below zero. What is left
 *   (the excess, when the parent was already paid) is either a supplier credit a later SupplierPayment consumes
 *   (SUPPLIER_CREDIT) or cash the supplier paid back (CASH_REFUND, one DocumentPayment + CashBankMovement IN).
 *   Its amountRemain is the credit still available, stored NEGATIVE (the sign of its netAmount), so every
 *   "amountRemain > 0" payable query keeps ignoring it and a plain sum of amountRemain nets it.
 *
 * No column stores how much of a negative adjustment went to the parent, so the family is recomputed from the stored
 * facts every time: the parent's open amount (net - its active payments) is handed to the ACTIVE negative adjustments in
 * posting order; each takes at most its reduction minus what is already fixed elsewhere (credit consumed by an ACTIVE
 * payment, cash refunded). Payments on a document can never exceed its outstanding balance, so a new payment can never
 * shrink an earlier allocation; cancelling a parent payment moves unconsumed credit back onto the parent.
 */

type Tx = Prisma.TransactionClient;
type Money = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);
const ACTIVE_PAYMENT = { payment: { status: "ACTIVE" as const } };

export type DebitAdjustmentShare = {
  id: string;
  /** |netAmount| of the negative adjustment. */
  reduction: Money;
  /** Credit consumed by ACTIVE supplier payments. */
  consumed: Money;
  /** Cash the supplier paid back (CASH_REFUND). */
  refunded: Money;
};

export type DebitFamilyAllocation = {
  parentRemain: Money;
  adjustments: Array<{ id: string; applied: Money; creditRemain: Money }>;
};

/** Pure waterfall: the parent's open amount is taken by the adjustments in the given (posting) order. */
export function allocateDebitFamilyBalance(parentOpen: Money, adjustments: readonly DebitAdjustmentShare[]): DebitFamilyAllocation {
  let open = Prisma.Decimal.max(ZERO, parentOpen);
  const shares = adjustments.map((adjustment) => {
    const fixed = adjustment.consumed.plus(adjustment.refunded);
    const applied = Prisma.Decimal.min(Prisma.Decimal.max(ZERO, adjustment.reduction.minus(fixed)), open);
    open = open.minus(applied);
    const creditRemain = Prisma.Decimal.max(ZERO, adjustment.reduction.minus(applied).minus(fixed));
    return { id: adjustment.id, applied, creditRemain };
  });
  return { parentRemain: open, adjustments: shares };
}

const sumPaid = (items: ReadonlyArray<{ paidAmount: Money | number }>): Money =>
  items.reduce((sum, item) => sum.plus(item.paidAmount), ZERO);

/** Cash refunded per negative adjustment (its SUPPLIER_DEBIT_REFUND DocumentPayment rows). */
async function readRefundedAmounts(tx: Tx, adjustmentIds: string[]): Promise<Map<string, Money>> {
  if (adjustmentIds.length === 0) return new Map();
  const rows = await tx.documentPayment.findMany({
    where: { docType: DocumentPaymentDocType.SUPPLIER_DEBIT_REFUND, docId: { in: adjustmentIds } },
    select: { docId: true, amount: true },
  });
  const totals = new Map<string, Money>();
  for (const row of rows) totals.set(row.docId, (totals.get(row.docId) ?? ZERO).plus(row.amount));
  return totals;
}

/** Recomputes the parent DN and all its ACTIVE negative adjustments. */
async function recalculateDebitFamily(tx: Tx, parentId: string): Promise<void> {
  const parent = await tx.supplierDebitNote.findUniqueOrThrow({ where: { id: parentId }, select: {
    status: true, netAmount: true,
    supplierPaymentItems: { where: ACTIVE_PAYMENT, select: { paidAmount: true } },
    adjustments: { where: { status: "ACTIVE", netAmount: { lt: 0 } },
      orderBy: [{ postingDate: "asc" }, { createdAt: "asc" }, { debitNo: "asc" }],
      select: { id: true, netAmount: true, amountRemain: true, excessSettlementType: true,
        supplierPaymentItems: { where: ACTIVE_PAYMENT, select: { paidAmount: true } } } },
  } });
  const adjustments = parent.adjustments ?? [];
  const refunded = await readRefundedAmounts(tx, adjustments
    .filter((row) => row.excessSettlementType === PurchaseReturnSettlementType.CASH_REFUND).map((row) => row.id));
  const parentOpen = parent.status === "CANCELLED" ? ZERO
    : new Prisma.Decimal(parent.netAmount).minus(sumPaid(parent.supplierPaymentItems ?? []));
  const allocation = allocateDebitFamilyBalance(parentOpen, adjustments.map((row) => ({ id: row.id,
    reduction: new Prisma.Decimal(row.netAmount).abs(), consumed: sumPaid(row.supplierPaymentItems ?? []),
    refunded: refunded.get(row.id) ?? ZERO })));
  await tx.supplierDebitNote.update({ where: { id: parentId }, data: { amountRemain: allocation.parentRemain } });
  for (const share of allocation.adjustments) {
    const stored = adjustments.find((row) => row.id === share.id);
    const next = share.creditRemain.isZero() ? ZERO : share.creditRemain.negated();
    if (!stored || !new Prisma.Decimal(stored.amountRemain).equals(next)) {
      await tx.supplierDebitNote.update({ where: { id: share.id }, data: { amountRemain: next } });
    }
  }
}

/**
 * Recalculates the outstanding balance after any payment, cancel or adjustment change. A regular DN or a negative
 * adjustment recomputes its whole family (parent + negative adjustments); a positive adjustment is its own payable.
 */
export async function recalculateSupplierDebitBalance(tx: Tx, debitNoteId: string): Promise<void> {
  try {
    const debit = await tx.supplierDebitNote.findUniqueOrThrow({ where: { id: debitNoteId },
      select: { status: true, netAmount: true, adjustsDebitNoteId: true,
        supplierPaymentItems: { where: ACTIVE_PAYMENT, select: { paidAmount: true } } } });
    const net = new Prisma.Decimal(debit.netAmount);
    if (debit.adjustsDebitNoteId && net.gt(0)) {
      await tx.supplierDebitNote.update({ where: { id: debitNoteId }, data: { amountRemain: debit.status === "CANCELLED"
        ? ZERO : Prisma.Decimal.max(ZERO, net.minus(sumPaid(debit.supplierPaymentItems ?? []))) } });
      return;
    }
    if (debit.adjustsDebitNoteId && debit.status === "CANCELLED") {
      await tx.supplierDebitNote.update({ where: { id: debitNoteId }, data: { amountRemain: ZERO } });
    }
    await recalculateDebitFamily(tx, debit.adjustsDebitNoteId ?? debitNoteId);
  } catch (error) {
    console.error("[recalculateSupplierDebitBalance]", error);
    throw error;
  }
}

/** How a new negative adjustment splits between the parent's outstanding balance and the excess. */
export function splitDebitAdjustmentReduction(parentRemain: Money | number, reduction: Money | number): { applied: Money; excess: Money } {
  const open = Prisma.Decimal.max(ZERO, new Prisma.Decimal(parentRemain));
  const total = new Prisma.Decimal(reduction).abs();
  const applied = Prisma.Decimal.min(open, total);
  return { applied, excess: total.minus(applied) };
}

/** Refund method from the receiving account, the rule purchase-return cash refunds use. */
export async function resolveSupplierDebitRefundMethod(tx: Tx, accountId: string): Promise<PurchaseReturnRefundMethod> {
  try {
    const account = await tx.cashBankAccount.findUnique({ where: { id: accountId }, select: { type: true } });
    if (!account) throw new Error("ไม่พบบัญชีรับเงินคืนจากซัพพลายเออร์");
    return account.type === "CASH" ? PurchaseReturnRefundMethod.CASH : PurchaseReturnRefundMethod.TRANSFER;
  } catch (error) {
    console.error("[resolveSupplierDebitRefundMethod]", error);
    throw error;
  }
}

/** CASH_REFUND of a negative adjustment: one DocumentPayment row and the matching cash/bank movement IN. */
export async function postSupplierDebitRefund(tx: Tx, input: {
  debitId: string; debitNo: string; accountId: string; amount: number; txnDate: Date; note: string | null;
}): Promise<void> {
  try {
    const rows = [{ cashBankAccountId: input.accountId, amount: input.amount, note: null }];
    await replaceDocumentPayments(tx, DocumentPaymentDocType.SUPPLIER_DEBIT_REFUND, input.debitId, CashBankDirection.IN, rows);
    await replaceCashBankSourceMovements(tx, CashBankSourceType.SUPPLIER_DEBIT_REFUND, input.debitId, toCashBankEntries(rows, {
      txnDate: input.txnDate, direction: CashBankDirection.IN, referenceNo: input.debitNo, note: input.note }));
  } catch (error) {
    console.error("[postSupplierDebitRefund]", error);
    throw error;
  }
}

/** Reverses the refund movement and its DocumentPayment row (adjustment cancel). */
export async function clearSupplierDebitRefund(tx: Tx, debitId: string): Promise<void> {
  try {
    await clearCashBankSourceMovements(tx, CashBankSourceType.SUPPLIER_DEBIT_REFUND, debitId);
    await clearDocumentPayments(tx, DocumentPaymentDocType.SUPPLIER_DEBIT_REFUND, debitId);
  } catch (error) {
    console.error("[clearSupplierDebitRefund]", error);
    throw error;
  }
}

/** Thai label of an adjustment wherever it is listed: "ปรับยอดจาก DN SDN26090001". */
export const SUPPLIER_DEBIT_ADJUSTMENT_LABEL = "ปรับยอด DN";
export const formatSupplierDebitAdjustmentLabel = (parentDebitNo: string): string => `ปรับยอดจาก DN ${parentDebitNo}`;
