import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// R14 leftovers + R2 on credit notes:
// 1. A missing / cancelled source sale, or a sale of another customer, is a Thai user
//    error on create and update — no critical alert, nothing written.
// 2. createCreditNote locks the RETURN lines' products once, sorted, before the checks
//    and writes (as updateCreditNote does), instead of one by one in line order.
// 3. updateCreditNote checks only the RETURN_IN rows it deletes against a later ACTIVE
//    supplier DN: a removed line on such a SKU is refused before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;
type Where = { where?: Record<string, unknown>; distinct?: unknown; select?: Record<string, unknown> };

const CN_NO = "CN26090001";
const debitRow = { productId: "p-2", docNo: "SDN26090001", docDate: new Date("2026-09-28T17:00:00.000Z"), sorder: 9, valuationEpoch: 1 };
const cnRowStock = { productId: "p-2", docNo: CN_NO, docDate: new Date("2026-09-09T17:00:00.000Z"), sorder: 2, valuationEpoch: 0 };

let callLog: string[] = [];
let criticalReports = 0;
let saleState: "ACTIVE" | "CANCELLED" | "MISSING" = "ACTIVE";
let saleCustomerId = "cust-1";
let laterDebitActive = false;

const record = (entry: string) => {
  callLog.push(entry);
};

const WRITE_ENTRY = /\.(create|update|delete|deleteMany|write)$|^stockCard\.write/;

const fakeTx: FakeTx = {
  // Month lock (lib/period-lock.ts): no month is declared here — see credit-note-period-lock.test.ts.
  $executeRaw: async () => 0,
  profitDistribution: { findMany: async () => [] },
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return [{ status: "ACTIVE" }];
  },
  receiptItem: { findMany: async () => [] },
  marketplaceSettlementLine: { findMany: async () => [] },
  expense: { findMany: async () => [] },
  sale: {
    findUnique: async (args: unknown) => {
      if ((args as Where).select?.items) return { items: [] };
      record("sale.validate");
      if (saleState === "MISSING") return null;
      return { id: "sale-1", status: saleState, customerId: saleCustomerId, saleNo: "SA26090001", channel: "STORE", vatType: "NO_VAT", vatRate: 0 };
    },
  },
  saleItem: {
    findMany: async () => [
      { id: "si-1", productId: "p-1", quantity: 5 },
      { id: "si-2", productId: "p-2", quantity: 5 },
    ],
  },
  productUnit: {
    findMany: async () => [
      { productId: "p-1", name: "ชิ้น", scale: 1 },
      { productId: "p-2", name: "ชิ้น", scale: 1 },
    ],
  },
  product: {
    findMany: async () => [
      { id: "p-1", inventoryTracking: "TRACKED", isLotControl: false },
      { id: "p-2", inventoryTracking: "TRACKED", isLotControl: false },
    ],
  },
  creditNote: {
    // The date re-read under the row lock falls back to the pre-transaction read.
    findUnique: async () => null,
    findMany: async () => [{ cnNo: CN_NO }],
    create: async () => {
      record("creditNote.create");
      return { id: "cn-new" };
    },
    update: async () => {
      record("creditNote.update");
      return {};
    },
  },
  creditNoteItem: {
    groupBy: async () => [],
    create: async () => {
      record("creditNoteItem.create");
      return { id: "cni-new" };
    },
    update: async () => {
      record("creditNoteItem.update");
      return {};
    },
    deleteMany: async () => {
      record("creditNoteItem.deleteMany");
      return { count: 1 };
    },
  },
  stockCard: {
    findMany: async (args: unknown) => {
      const { where = {}, distinct } = args as Where;
      if (distinct) return [{ productId: "p-2" }];
      if (JSON.stringify(where.source ?? null).includes("SUPPLIER_DEBIT")) return laterDebitActive ? [debitRow] : [];
      return where.docNo === CN_NO ? [cnRowStock] : [];
    },
    deleteMany: async () => {
      record("stockCard.deleteMany");
      return { count: 1 };
    },
  },
  supplierDebitNote: {
    findMany: async (args: unknown) =>
      laterDebitActive && (args as Where).where?.status === "ACTIVE" ? [{ id: "dn-1", debitNo: debitRow.docNo }] : [],
  },
};

const creditNoteRow = () => ({
  id: "cn1", cnNo: CN_NO, status: "ACTIVE", type: "RETURN", settlementType: "CREDIT_DEBT", refundMethod: null,
  channel: null, saleId: "sale-1", sale: null, customerId: "cust-1", customer: null, customerName: null,
  cnDate: new Date("2026-09-09T17:00:00.000Z"), marketplaceReturnRef: null, cashBankAccountId: null,
  totalAmount: 100, amountRemain: 100, subtotalAmount: 100, vatAmount: 0, vatType: "NO_VAT", vatRate: 0,
  note: null, cancelNote: null, cancelledAt: null,
  items: [{ id: "cni-old", productId: "p-2", saleItemId: "si-2", stockDisposition: "RESTOCK", stockDispositionNote: null, qty: 1, unitPrice: 100, lotItems: [] }],
});

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  if (moduleMocksUnavailable) return;
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: { ...realAuth, requirePermission: async () => ({ user: { id: "user-1" } }) },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async () => {
        criticalReports += 1;
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", { namedExports: { ...realDocNumber, generateCNNo: async () => "CN26090002" } });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        record("stockCard.write");
        return "sc-1";
      },
      recalculateStockCardMany: async () => undefined,
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLotControl,
      reverseCreditNoteLotBalance: async () => undefined,
      writeCreditNoteLots: async () => undefined,
      writeStockMovementLots: async () => undefined,
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, replaceDocumentPayments: async () => undefined },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculateCNAmountRemain: async () => undefined },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: { ...realProfitFact, rebuildCreditNoteProfitFacts: async () => undefined },
  });
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: {
        sale: { findUnique: async () => ({ channel: "STORE", cashBankAccountId: null }) },
        creditNote: { findUnique: async () => creditNoteRow(), findMany: async () => [{ cnNo: CN_NO }] },
        documentPayment: { findMany: async () => [] },
        productUnit: {
          findMany: async () => [
            { productId: "p-1", name: "ชิ้น", scale: 1 },
            { productId: "p-2", name: "ชิ้น", scale: 1 },
          ],
        },
        receiptItem: { findMany: async () => [], findFirst: async () => null },
        marketplaceSettlementLine: { findMany: async () => [] },
        expense: { findMany: async () => [] },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  actions = await import("../actions");
});

beforeEach(() => {
  callLog = [];
  criticalReports = 0;
  saleState = "ACTIVE";
  saleCustomerId = "cust-1";
  laterDebitActive = false;
});

const returnLine = (productId: string) => ({
  productId, saleItemId: productId === "p-1" ? "si-1" : "si-2",
  unitName: "ชิ้น", qty: 1, salePrice: 100, stockDisposition: "RESTOCK", lotItems: [],
});
const cnForm = (items: unknown[], type = "RETURN") => {
  const form = new FormData();
  form.set("cnDate", "2026-09-10");
  form.set("customerId", "cust-1");
  form.set("saleId", "sale-1");
  form.set("type", type);
  form.set("settlementType", "CREDIT_DEBT");
  form.set("vatType", "NO_VAT");
  form.set("vatRate", "0");
  form.set("items", JSON.stringify(items));
  return form;
};
const writes = () => callLog.filter((entry) => WRITE_ENTRY.test(entry));

const SALE_MISSING_MESSAGE = "ไม่พบใบขายอ้างอิง หรือเอกสารถูกยกเลิกแล้ว";
const WRONG_CUSTOMER_MESSAGE = "ใบขาย SA26090001 ไม่ได้เป็นของลูกค้ารายที่เลือก";

for (const state of ["MISSING", "CANCELLED"] as const) {
  test(`create: a ${state.toLowerCase()} source sale is a Thai user error without a critical alert`, { skip: moduleMocksUnavailable }, async () => {
    saleState = state;
    const result = await actions.createCreditNote(cnForm([returnLine("p-1")], "DISCOUNT"));
    assert.deepEqual(result, { error: SALE_MISSING_MESSAGE });
    assert.deepEqual(writes(), []);
    assert.equal(criticalReports, 0);
  });
}

test("create: a sale of another customer is a Thai user error without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  saleCustomerId = "cust-2";
  const result = await actions.createCreditNote(cnForm([returnLine("p-1")], "DISCOUNT"));
  assert.deepEqual(result, { error: WRONG_CUSTOMER_MESSAGE });
  assert.deepEqual(writes(), []);
  assert.equal(criticalReports, 0);
});

test("update: missing sale and wrong customer are Thai user errors without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  saleState = "MISSING";
  assert.deepEqual(await actions.updateCreditNote("cn1", cnForm([returnLine("p-2")])), { error: SALE_MISSING_MESSAGE });
  saleState = "ACTIVE";
  saleCustomerId = "cust-2";
  assert.deepEqual(await actions.updateCreditNote("cn1", cnForm([returnLine("p-2")])), { error: WRONG_CUSTOMER_MESSAGE });
  assert.deepEqual(writes(), []);
  assert.equal(criticalReports, 0);
});

test("create: RETURN products are locked once, sorted, before the source-sale check and any write", { skip: moduleMocksUnavailable }, async () => {
  const result = await actions.createCreditNote(cnForm([returnLine("p-2"), returnLine("p-1")]));
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.equal(callLog[0], "lock:Product:p-1,p-2");
  assert.equal(callLog[1], "sale.validate");
  assert.equal(callLog.filter((entry) => entry.startsWith("lock:Product:")).length, 1);
  assert.equal(callLog.filter((entry) => entry === "stockCard.write").length, 2);
});

test("update: removing a RETURN line whose SKU has a later active DN is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  laterDebitActive = true;
  const result = await actions.updateCreditNote("cn1", cnForm([returnLine("p-1")]));
  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.deepEqual(writes(), []);
  assert.equal(criticalReports, 0);
});

test("update: a header-only edit of the same CN saves even with the later active DN", { skip: moduleMocksUnavailable }, async () => {
  laterDebitActive = true;
  const form = cnForm([returnLine("p-2")]);
  form.set("note", "แก้ไขเฉพาะหมายเหตุ");
  const result = await actions.updateCreditNote("cn1", form);
  assert.deepEqual(result, { success: true });
  assert.ok(!callLog.includes("stockCard.deleteMany"));
  assert.equal(criticalReports, 0);
});
