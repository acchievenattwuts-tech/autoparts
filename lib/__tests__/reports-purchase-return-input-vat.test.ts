import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

/**
 * Review V3: a purchase return that references a purchase inherits the PURCHASE's input-VAT recoverability
 * (its VAT type, rate and tax-invoice date); only a return without a purchase is decided by its own
 * credit-note date. The shop is VAT-registered from 2026-09-01.
 */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const day = (value: string): Date => parseDateOnlyToDate(value);
const docDate = day("2026-09-20");
const supplier = { code: "S001", name: "Supplier A" };

const purchase = (purchaseNo: string, vatAmount: number, taxInvoiceDate: Date) => ({
  id: purchaseNo, purchaseNo, purchaseDate: docDate, purchaseType: "CREDIT_PURCHASE", paymentMethod: null, cashBankAccountId: null,
  referenceNo: null, note: null, supplierId: "sup-1", cashBankAccount: null, supplier, netAmount: D(vatAmount * 100 / 7 + vatAmount),
  amountRemain: D(0), vatAmount: D(vatAmount), vatType: "EXCLUDING_VAT", vatRate: D(7), taxInvoiceDate });
type SourcePurchase = { vatType: string; vatRate: Prisma.Decimal; taxInvoiceDate: Date | null };
const purchaseReturn = (returnNo: string, vatAmount: number, creditNoteDate: Date, source: SourcePurchase | null) => ({
  id: returnNo, returnNo, returnDate: docDate, supplierId: "sup-1", supplier, totalAmount: D(vatAmount * 100 / 7 + vatAmount),
  amountRemain: D(0), settlementType: "SUPPLIER_CREDIT", refundMethod: null, note: null, cashBankAccount: null,
  vatAmount: D(vatAmount), vatType: "EXCLUDING_VAT", vatRate: D(7), taxInvoiceDate: creditNoteDate, purchase: source });

// PU-REC: tax invoice after registration (recoverable, 70). PU-OLD: before registration (cost, 7).
const recoverablePurchase = { vatType: "EXCLUDING_VAT", vatRate: D(7), taxInvoiceDate: day("2026-09-10") };
const costPurchase = { vatType: "EXCLUDING_VAT", vatRate: D(7), taxInvoiceDate: day("2026-08-20") };
const purchases = [purchase("PU-REC", 70, recoverablePurchase.taxInvoiceDate), purchase("PU-OLD", 7, costPurchase.taxInvoiceDate)];

let purchaseReturns: ReturnType<typeof purchaseReturn>[] = [];
let reports: typeof import("@/lib/reports");

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [], aggregate: async () => ({ _sum: {} }) };
  const models: Record<string, unknown> = {
    $queryRaw: async () => [],
    purchase: { findMany: async () => purchases },
    purchaseReturn: { findMany: async () => purchaseReturns },
    siteContent: { findUnique: async () => ({ value: "2026-09-01" }) },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
});

const purchaseVat = async (): Promise<number> => {
  const { profitLoss } = await reports.getReportsData({ from: day("2026-09-01"), to: parseDateOnlyToEndOfDay("2026-09-30"),
    fromInput: "2026-09-01", toInput: "2026-09-30", customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
    productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });
  return profitLoss.purchaseVat;
};

test("V3: a return of a recoverable purchase reduces input VAT even when its credit-note date is before registration", { skip: mocksUnavailable }, async () => {
  purchaseReturns = [purchaseReturn("PR-A", 14, day("2026-08-25"), recoverablePurchase)];
  assert.equal(await purchaseVat(), 70 - 14);
});

test("V3: a return of a non-recoverable purchase never reduces input VAT, even with a credit-note date after registration", { skip: mocksUnavailable }, async () => {
  purchaseReturns = [purchaseReturn("PR-B", 3.5, day("2026-09-15"), costPurchase)];
  assert.equal(await purchaseVat(), 70);
});

test("a return without a purchase is still decided by its own credit-note date", { skip: mocksUnavailable }, async () => {
  purchaseReturns = [purchaseReturn("PR-C", 7, day("2026-09-15"), null), purchaseReturn("PR-D", 3.5, day("2026-08-30"), null)];
  assert.equal(await purchaseVat(), 70 - 7);
});

test("all together: 70 − 14 (PR-A inherited) − 7 (PR-C own) = 49 — the return's own dates alone would give 59.5", { skip: mocksUnavailable }, async () => {
  purchaseReturns = [
    purchaseReturn("PR-A", 14, day("2026-08-25"), recoverablePurchase),
    purchaseReturn("PR-B", 3.5, day("2026-09-15"), costPurchase),
    purchaseReturn("PR-C", 7, day("2026-09-15"), null),
    purchaseReturn("PR-D", 3.5, day("2026-08-30"), null),
  ];
  assert.equal(await purchaseVat(), 49);
});
