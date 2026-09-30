import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/**
 * ก3: a supplier payment applies the credit of a negative "ปรับยอด DN" (adj-1, credit 200 = amountRemain -200) against a
 * 1,000 credit purchase. Cash paid is 800; the credit line is stored in SupplierPaymentItem.debitNoteId and both the
 * adjustment and its parent DN are row-locked and recalculated.
 */
type Captured = { payment: Record<string, unknown> | null; items: Array<Record<string, unknown>>; recalculated: string[];
  locks: unknown[][]; cash: Array<{ sourceType: string; entries: Array<{ amount: number; direction: string }> }> };
let captured: Captured;
const purchase = { id: "po-1", purchaseNo: "PU26090010", purchaseDate: parseDateOnlyToDate("2026-09-01"),
  netAmount: new Prisma.Decimal(1000), amountRemain: new Prisma.Decimal(1000), supplierPaymentItems: [] };
const credit = { id: "adj-1", debitNo: "SDN26090002", postingDate: parseDateOnlyToDate("2026-09-30"), netAmount: new Prisma.Decimal(-200),
  amountRemain: new Prisma.Decimal(-200), adjustsDebitNote: { debitNo: "SDN26080001" }, supplierPaymentItems: [] };
const tx = {
  $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => { captured.locks.push(values); return []; },
  supplierDebitNote: { findMany: async ({ where }: { where: { id?: unknown; netAmount?: { gt?: number; lt?: number } } }) => {
    if (where.id) return [{ adjustsDebitNoteId: "dn-parent" }];
    return where.netAmount?.lt !== undefined ? [credit] : [];
  } },
  purchase: { findMany: async () => [purchase] },
  purchaseReturn: { findMany: async () => [] },
  supplierAdvance: { findMany: async () => [] },
  cashBankAccount: { findMany: async () => [{ type: "BANK" }] },
  supplierPayment: { create: async ({ data }: { data: Record<string, unknown> }) => { captured.payment = data; return { id: "pay-2", ...data }; } },
  supplierPaymentItem: { createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { captured.items = data; return { count: data.length }; } },
  documentPayment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) },
};
let actions: typeof import("../actions");

before(async () => {
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/require-auth", { namedExports: {
    requirePermission: async () => ({ user: { id: "user-1", permissions: [] } }),
    requireAnyPermission: async () => ({ user: { id: "user-1", permissions: [] } }),
  } });
  await mock.module("@/lib/audit-log", { namedExports: { diffEntity: () => ({ before: {}, after: {} }),
    getAuditActorFromSession: () => ({ userId: "user-1" }), getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined } });
  await mock.module("@/lib/db", { namedExports: {
    db: { supplierPayment: { findUnique: async () => null }, documentPayment: { findMany: async () => [] } },
    dbTx: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  } });
  await mock.module("@/lib/doc-number", { namedExports: { generateSupplierPaymentNo: async () => "SP26090002" } });
  await mock.module("@/lib/supplier-debit-note", { namedExports: {
    recalculateSupplierDebitRemain: async (_client: unknown, id: string) => { captured.recalculated.push(id); },
  } });
  await mock.module("@/lib/amount-remain", { namedExports: {
    recalculatePurchaseAmountRemain: async () => undefined, recalculatePurchaseReturnAmountRemain: async () => undefined,
    recalculateSupplierAdvanceAmountRemain: async () => undefined,
  } });
  await mock.module("@/lib/cash-bank", { namedExports: {
    replaceCashBankSourceMovements: async (_client: unknown, sourceType: string, _id: string, entries: Array<{ amount: number; direction: string }>) => {
      captured.cash.push({ sourceType, entries });
    },
    clearCashBankSourceMovements: async () => undefined,
  } });
  await mock.module("@/lib/wht-certificate", { namedExports: { persistWhtCertificate: async () => undefined, cancelWhtCertificateForSource: async () => undefined } });
  actions = await import("../actions");
});
beforeEach(() => { captured = { payment: null, items: [], recalculated: [], locks: [], cash: [] }; });

const form = (items: unknown[], cash: number): FormData => {
  const data = new FormData();
  data.set("supplierId", "supplier-1"); data.set("paymentDate", "2026-09-30"); data.set("note", ""); data.set("wht", "");
  data.set("payments", JSON.stringify(cash > 0 ? [{ cashBankAccountId: "acc-bank", amount: cash }] : []));
  data.set("items", JSON.stringify(items));
  return data;
};

describe("supplier payment applying a ปรับยอด DN credit", () => {
  it("1,000 purchase - 200 credit = 800 cash; the credit is stored on debitNoteId and the family is recalculated", async () => {
    const result = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 1000 }, { debitCreditId: "adj-1", paidAmount: 200 }], 800));
    assert.deepEqual(result, { success: true, paymentNo: "SP26090002" });
    assert.equal(captured.payment?.totalAmount, 800);
    assert.deepEqual(captured.items.map((item) => [item.purchaseId, item.debitNoteId, item.paidAmount]), [["po-1", null, 1000], [null, "adj-1", 200]]);
    assert.deepEqual(captured.recalculated, ["adj-1"]);
    assert.deepEqual(captured.cash.map((row) => [row.sourceType, row.entries.map((entry) => [entry.direction, entry.amount])]),
      [["SUPPLIER_PAYMENT", [["OUT", 800]]]]);
    // The adjustment and its parent DN are locked together, in id order.
    assert.ok(captured.locks.some((values) => JSON.stringify(values).includes(JSON.stringify(["adj-1", "dn-parent"]))));
  });

  it("the credit cannot be paid as if it were a payable (no sign flip) nor used beyond its 200", async () => {
    const asPayable = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 1000 }, { debitNoteId: "adj-1", paidAmount: 200 }], 1200));
    assert.equal(asPayable.success, false);
    assert.match(asPayable.error ?? "", /DN ที่ไม่สามารถใช้ชำระได้/);
    const tooMuch = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 1000 }, { debitCreditId: "adj-1", paidAmount: 250 }], 750));
    assert.equal(tooMuch.success, false);
    assert.match(tooMuch.error ?? "", /มากกว่ายอดคงเหลือ/);
    assert.equal(captured.payment, null);
  });
});
