import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate, parseDateOnlyToEndOfDay } from "@/lib/th-date";

/**
 * Review V7: the management report's input VAT counts only recoverable VAT (lib/input-vat.ts). With the shop registered
 * from 2026-09-01:
 * - purchases: PU-A 70 (tax invoice 2026-09-10) counts; PU-B 7 (2026-08-25, before registration) and PU-C 21 (no date) do not;
 * - purchase returns: PR-A 14 (2026-09-15) is taken off; PR-B 3.5 (2026-08-30) is not;
 * - DNs keep the decision stored when posted: 35 and its adjustment -7 count, the non-recoverable DN's 21 does not;
 * - expenses: OE-A 7 (2026-09-12) is input tax and its expense is 100; OE-B (no date) stays 214, OE-C (no VAT) 50.
 */
const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
const day = (value: string): Date => parseDateOnlyToDate(value);
const docDate = day("2026-09-20");
const supplier = { code: "S001", name: "Supplier A" };

const purchase = (purchaseNo: string, vatType: string, vatAmount: number, netAmount: number, taxInvoiceDate: Date | null) => ({
  id: purchaseNo, purchaseNo, purchaseDate: docDate, purchaseType: "CREDIT_PURCHASE", paymentMethod: null, cashBankAccountId: null,
  referenceNo: null, note: null, supplierId: "sup-1", cashBankAccount: null, supplier, netAmount: D(netAmount), amountRemain: D(netAmount),
  vatAmount: D(vatAmount), vatType, vatRate: D(7), taxInvoiceDate });
const purchaseReturn = (returnNo: string, vatAmount: number, taxInvoiceDate: Date | null) => ({
  id: returnNo, returnNo, returnDate: docDate, supplierId: "sup-1", supplier, totalAmount: D(vatAmount * 100 / 7 + vatAmount),
  amountRemain: D(0), settlementType: "SUPPLIER_CREDIT", refundMethod: null, note: null, cashBankAccount: null,
  vatAmount: D(vatAmount), vatType: "EXCLUDING_VAT", vatRate: D(7), taxInvoiceDate });
const debit = (vatAmount: number, vatRecoverable: boolean) => ({ varianceAmount: D(0), vatAmount: D(vatAmount), vatRecoverable,
  supplierId: "sup-1", netAmount: D(vatAmount * 100 / 7 + vatAmount), supplier });
const expense = (expenseNo: string, vatType: string, [subtotal, vat]: [number, number], taxInvoiceDate: Date | null) => ({
  id: expenseNo, expenseNo, expenseDate: docDate, note: null, totalAmount: D(subtotal), vatAmount: D(vat), netAmount: D(subtotal + vat),
  subtotalAmount: D(subtotal), vatType, vatRate: D(vatType === "NO_VAT" ? 0 : 7), taxInvoiceDate, cashBankAccount: null,
  items: [{ amount: D(subtotal), description: null, expenseCode: { code: "E01", name: "ค่าบริการ" } }] });

const purchases = [purchase("PU-A", "EXCLUDING_VAT", 70, 1070, day("2026-09-10")),
  purchase("PU-B", "INCLUDING_VAT", 7, 107, day("2026-08-25")), purchase("PU-C", "EXCLUDING_VAT", 21, 321, null)];
const purchaseReturns = [purchaseReturn("PR-A", 14, day("2026-09-15")), purchaseReturn("PR-B", 3.5, day("2026-08-30"))];
const debits = [debit(35, true), debit(-7, true), debit(21, false)];
const expenses = [expense("OE-A", "EXCLUDING_VAT", [100, 7], day("2026-09-12")), expense("OE-B", "EXCLUDING_VAT", [200, 14], null),
  expense("OE-C", "NO_VAT", [50, 0], null)];

let registeredFrom: string | null = "2026-09-01";
let registrationReads = 0;
let reports: typeof import("@/lib/reports");

before(async () => {
  if (mocksUnavailable) return;
  const emptyModel = { findMany: async () => [], aggregate: async () => ({ _sum: {} }) };
  const models: Record<string, unknown> = {
    $queryRaw: async () => [],
    purchase: { findMany: async () => purchases },
    purchaseReturn: { findMany: async () => purchaseReturns },
    // Only the P&L DN query selects varianceAmount; the AP and refund queries get nothing here.
    supplierDebitNote: { findMany: async (args: { select: { varianceAmount?: unknown } }) => (args.select.varianceAmount ? debits : []) },
    expense: { findMany: async () => expenses },
    siteContent: { findUnique: async () => { registrationReads += 1; return registeredFrom ? { value: registeredFrom } : null; } },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  reports = await import("@/lib/reports");
});

const report = () => reports.getReportsData({ from: day("2026-09-01"), to: parseDateOnlyToEndOfDay("2026-09-30"),
  fromInput: "2026-09-01", toInput: "2026-09-30", customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "",
  productCodeFrom: "", productCodeTo: "", expenseCodeFrom: "", expenseCodeTo: "" });

test("V7 registered: input VAT = 70 - 14 + (35 - 7) = 84, expense VAT 7, expense 364, VAT payable -91", { skip: mocksUnavailable }, async () => {
  registeredFrom = "2026-09-01"; registrationReads = 0;
  const { profitLoss, expenses: expenseSection } = await report();
  assert.equal(profitLoss.purchaseVat, 84);
  assert.equal(profitLoss.expenseVat, 7);
  assert.equal(profitLoss.expenseTotal, 364);
  assert.equal(profitLoss.netProfit, -364);
  assert.equal(profitLoss.vatPayable, -91);
  assert.equal(registrationReads, 1, "one read of the registration setting per report");
  // The expense section keeps the document amounts as keyed.
  assert.deepEqual([expenseSection.totalVatAmount, expenseSection.totalNetAmount], [21, 371]);
});

test("V7 not registered: only the DNs' stored input VAT counts (28); every expense VAT is expense (371)", { skip: mocksUnavailable }, async () => {
  registeredFrom = null;
  const { profitLoss } = await report();
  assert.equal(profitLoss.purchaseVat, 28);
  assert.equal(profitLoss.expenseVat, 0);
  assert.equal(profitLoss.expenseTotal, 371);
  assert.equal(profitLoss.vatPayable, -28);
});
