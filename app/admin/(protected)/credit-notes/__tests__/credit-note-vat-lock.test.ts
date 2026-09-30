import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Credit note ↔ source sale:
// 1. A credit note that references a sale must use the sale's VAT. create and update
//    reject a mismatch in either direction with a Thai message, before any write and
//    without a critical alert. Credit notes without a sale reference are unchanged.
// 2. updateCreditNote maps DocumentMutationBlockedError (e.g. writeStockCard refusing a
//    backdated RETURN_IN across a supplier DN) to its user message, without a critical alert.
// 3. updateCreditNote locks the old and new lines' products in ONE sorted batch right
//    after the CreditNote row, before the guard reads.
// 4. On edit, every kept line gets subtotalAmount recomputed, even with unchanged VAT.
//
// The real document-mutation-guard, credit-note helpers and vat maths run here; only
// the database and side-effect modules are faked.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;
type CnItemRow = {
  id: string;
  productId: string;
  saleItemId: string | null;
  stockDisposition: string;
  stockDispositionNote: string | null;
  qty: number;
  unitPrice: number;
  lotItems: never[];
};

let callLog: string[] = [];
let criticalReports = 0;
let saleVat: { vatType: string; vatRate: number };
let cnRow: {
  type: string;
  saleId: string | null;
  vatType: string;
  vatRate: number;
  items: CnItemRow[];
};
/** Products that already have StockCard rows under the credit note number. */
let stockProductsInTx: string[];
let writeStockCardError: Error | null;
let itemUpdates: Array<Record<string, unknown>> = [];

const record = (entry: string) => {
  callLog.push(entry);
};

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
  // Guard reads (CreditNote branch of the document mutation guard).
  receiptItem: {
    findMany: async () => {
      record("guard:ReceiptItem");
      return [];
    },
  },
  marketplaceSettlementLine: {
    findMany: async () => {
      record("guard:MarketplaceSettlementLine");
      return [];
    },
  },
  expense: {
    findMany: async () => {
      record("guard:Expense");
      return [];
    },
  },
  sale: {
    findUnique: async (args: unknown) => {
      const { select } = args as { select: Record<string, unknown> };
      if (select.items) {
        return { items: [{ id: "si-1", productId: "p-1", quantity: 2, costPrice: 50 }] };
      }
      record("sale.validate");
      return {
        id: "sale-1",
        status: "ACTIVE",
        customerId: "cust-1",
        saleNo: "SA26090001",
        channel: "STORE",
        ...saleVat,
      };
    },
  },
  saleItem: { findMany: async () => [{ id: "si-1", productId: "p-1", quantity: 2 }] },
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
    findMany: async () => [{ cnNo: "CN26090001" }],
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
    update: async (args: unknown) => {
      const { data } = args as { data: Record<string, unknown> };
      record("creditNoteItem.update");
      itemUpdates.push(data);
      return {};
    },
    deleteMany: async () => {
      record("creditNoteItem.deleteMany");
      return { count: 1 };
    },
  },
  stockCard: {
    findMany: async (args: unknown) => {
      const { distinct } = args as { distinct?: unknown };
      // lockMutableCreditNote asks for the CN's distinct stock products; the guard's
      // boundary read (no `distinct`) sees no later stock rows.
      return distinct ? stockProductsInTx.map((productId) => ({ productId })) : [];
    },
    deleteMany: async () => {
      record("stockCard.deleteMany");
      return { count: 1 };
    },
  },
};

const creditNoteRow = () => ({
  id: "cn1",
  cnNo: "CN26090001",
  status: "ACTIVE",
  type: cnRow.type,
  settlementType: "CREDIT_DEBT",
  refundMethod: null,
  channel: null,
  saleId: cnRow.saleId,
  sale: null,
  customerId: "cust-1",
  customer: null,
  customerName: null,
  cnDate: new Date("2026-09-10T00:00:00.000Z"),
  marketplaceReturnRef: null,
  cashBankAccountId: null,
  totalAmount: 100,
  amountRemain: 100,
  subtotalAmount: 100,
  vatAmount: 0,
  vatType: cnRow.vatType,
  vatRate: cnRow.vatRate,
  note: null,
  cancelNote: null,
  cancelledAt: null,
  items: cnRow.items,
});

type Actions = typeof import("../actions");
let actions: Actions;
let DocumentMutationBlockedError: typeof import("@/lib/document-mutation-guard").DocumentMutationBlockedError;

before(async () => {
  if (moduleMocksUnavailable) return;
  ({ DocumentMutationBlockedError } = await import("@/lib/document-mutation-guard"));
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", {
    namedExports: { ...realNextCache, revalidatePath: () => undefined },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
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
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateCNNo: async () => "CN26090002" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        record("stockCard.write");
        if (writeStockCardError) throw writeStockCardError;
        return "sc-1";
      },
      recalculateStockCardMany: async () => {
        record("stockCard.recalculate");
      },
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLotControl,
      reverseCreditNoteLotBalance: async () => {
        record("lot.reverse");
      },
      writeCreditNoteLots: async () => undefined,
      writeStockMovementLots: async () => undefined,
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async () => undefined,
    },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: {
      ...realPayments,
      clearDocumentPayments: async () => undefined,
      replaceDocumentPayments: async () => undefined,
    },
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
    namedExports: {
      ...realProfitFact,
      rebuildCreditNoteProfitFacts: async () => undefined,
      rebuildExpenseProfitFacts: async () => undefined,
    },
  });
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: {
        sale: { findUnique: async () => ({ channel: "STORE", cashBankAccountId: null }) },
        creditNote: { findUnique: async () => creditNoteRow() },
        documentPayment: { findMany: async () => [] },
        productUnit: {
          findMany: async () => [
            { productId: "p-1", name: "ชิ้น", scale: 1 },
            { productId: "p-2", name: "ชิ้น", scale: 1 },
          ],
        },
        // Pre-transaction fast path (checkDocumentMutation uses `db`).
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
  saleVat = { vatType: "NO_VAT", vatRate: 0 };
  cnRow = {
    type: "DISCOUNT",
    saleId: "sale-1",
    vatType: "NO_VAT",
    vatRate: 0,
    items: [],
  };
  stockProductsInTx = [];
  writeStockCardError = null;
  itemUpdates = [];
});

const INCLUDING_VAT_7_MESSAGE = "ภาษีของใบลดหนี้ต้องตรงกับใบขายอ้างอิง SA26090001 (ราคารวม VAT 7%)";
const NO_VAT_MESSAGE = "ภาษีของใบลดหนี้ต้องตรงกับใบขายอ้างอิง SA26090001 (ไม่มีภาษี)";

const discountLine = { productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 100 };

const cnForm = (fields: { saleId?: string; vatType: string; vatRate: string; type?: string; items?: unknown[] }) => {
  const form = new FormData();
  form.set("cnDate", "2026-09-10");
  form.set("customerId", "cust-1");
  if (fields.saleId) form.set("saleId", fields.saleId);
  form.set("type", fields.type ?? "DISCOUNT");
  form.set("settlementType", "CREDIT_DEBT");
  form.set("vatType", fields.vatType);
  form.set("vatRate", fields.vatRate);
  form.set("items", JSON.stringify(fields.items ?? [discountLine]));
  return form;
};

const LOCK_AND_GUARD = [
  "lock:CreditNote:cn1",
  "guard:ReceiptItem",
  "guard:MarketplaceSettlementLine",
  "guard:Expense",
];

// ─── 1. VAT must match the referenced sale ─────────────────────────────────

test("helper: a mismatch in either direction is reported, a match or an unused NO_VAT rate is not", async () => {
  const { getCreditNoteSaleVatMismatchMessage } = await import("../credit-note-action-helpers");
  const sale = (vatType: "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT", vatRate: number) => ({
    saleNo: "SA26090001",
    vatType,
    vatRate,
  });
  assert.equal(
    getCreditNoteSaleVatMismatchMessage(sale("INCLUDING_VAT", 7), { vatType: "NO_VAT", vatRate: 0 }),
    INCLUDING_VAT_7_MESSAGE,
  );
  assert.equal(
    getCreditNoteSaleVatMismatchMessage(sale("NO_VAT", 0), { vatType: "INCLUDING_VAT", vatRate: 7 }),
    NO_VAT_MESSAGE,
  );
  assert.equal(
    getCreditNoteSaleVatMismatchMessage(sale("EXCLUDING_VAT", 7), { vatType: "EXCLUDING_VAT", vatRate: 10 }),
    "ภาษีของใบลดหนี้ต้องตรงกับใบขายอ้างอิง SA26090001 (ราคาไม่รวม VAT 7%)",
    "same type, different rate is a mismatch",
  );
  assert.equal(
    getCreditNoteSaleVatMismatchMessage(sale("INCLUDING_VAT", 7), { vatType: "INCLUDING_VAT", vatRate: 7 }),
    null,
  );
  assert.equal(
    getCreditNoteSaleVatMismatchMessage(sale("NO_VAT", 7), { vatType: "NO_VAT", vatRate: 0 }),
    null,
    "the rate is ignored when neither side charges VAT",
  );
});

test("create: sale INCLUDING_VAT 7%, credit note NO_VAT → rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  saleVat = { vatType: "INCLUDING_VAT", vatRate: 7 };
  const result = await actions.createCreditNote(cnForm({ saleId: "sale-1", vatType: "NO_VAT", vatRate: "0" }));
  assert.deepEqual(result, { error: INCLUDING_VAT_7_MESSAGE });
  assert.deepEqual(callLog, ["sale.validate"], "nothing is written after the sale check");
  assert.equal(criticalReports, 0);
});

test("create: sale NO_VAT, credit note INCLUDING_VAT 7% → rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const result = await actions.createCreditNote(cnForm({ saleId: "sale-1", vatType: "INCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { error: NO_VAT_MESSAGE });
  assert.deepEqual(callLog, ["sale.validate"]);
  assert.equal(criticalReports, 0);
});

test("create: the sale's own VAT is accepted", { skip: moduleMocksUnavailable }, async () => {
  saleVat = { vatType: "INCLUDING_VAT", vatRate: 7 };
  const result = await actions.createCreditNote(cnForm({ saleId: "sale-1", vatType: "INCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.ok(callLog.includes("creditNote.create"));
  assert.equal(criticalReports, 0);
});

test("create: a credit note without a sale reference keeps any VAT", { skip: moduleMocksUnavailable }, async () => {
  saleVat = { vatType: "INCLUDING_VAT", vatRate: 7 };
  const result = await actions.createCreditNote(cnForm({ vatType: "EXCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.ok(!callLog.includes("sale.validate"), "no sale to compare against");
});

test("update: sale INCLUDING_VAT 7%, credit note NO_VAT → rejected after the lock and guard, before any write", { skip: moduleMocksUnavailable }, async () => {
  saleVat = { vatType: "INCLUDING_VAT", vatRate: 7 };
  const result = await actions.updateCreditNote("cn1", cnForm({ saleId: "sale-1", vatType: "NO_VAT", vatRate: "0" }));
  assert.deepEqual(result, { error: INCLUDING_VAT_7_MESSAGE });
  assert.deepEqual(callLog, [...LOCK_AND_GUARD, "sale.validate"]);
  assert.equal(criticalReports, 0);
});

test("update: sale NO_VAT, credit note INCLUDING_VAT 7% → rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const result = await actions.updateCreditNote("cn1", cnForm({ saleId: "sale-1", vatType: "INCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { error: NO_VAT_MESSAGE });
  assert.deepEqual(callLog, [...LOCK_AND_GUARD, "sale.validate"]);
  assert.equal(criticalReports, 0);
});

test("update: a credit note without a sale reference keeps any VAT", { skip: moduleMocksUnavailable }, async () => {
  cnRow.saleId = null;
  const result = await actions.updateCreditNote("cn1", cnForm({ vatType: "INCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { success: true });
  assert.ok(!callLog.includes("sale.validate"));
});

// ─── 2 + 3. update: stock boundary block, and one sorted product-lock batch ─

const returnLine = { ...discountLine, saleItemId: "si-1", stockDisposition: "RESTOCK" };
const setUpReturnEdit = () => {
  // The stored RETURN line is p-2; the edit replaces it with a p-1 line.
  cnRow.type = "RETURN";
  cnRow.items = [
    {
      id: "cni-old",
      productId: "p-2",
      saleItemId: null,
      stockDisposition: "RESTOCK",
      stockDispositionNote: null,
      qty: 1,
      unitPrice: 100,
      lotItems: [],
    },
  ];
  stockProductsInTx = ["p-2"];
};

test("update: old and new stock products are locked once, sorted, right after the CreditNote row and before the guard", { skip: moduleMocksUnavailable }, async () => {
  setUpReturnEdit();
  const result = await actions.updateCreditNote(
    "cn1",
    cnForm({ saleId: "sale-1", type: "RETURN", vatType: "NO_VAT", vatRate: "0", items: [returnLine] }),
  );
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog.slice(0, 5), [
    "lock:CreditNote:cn1",
    "lock:Product:p-1,p-2",
    "guard:ReceiptItem",
    "guard:MarketplaceSettlementLine",
    "guard:Expense",
  ]);
  assert.equal(callLog.filter((entry) => entry.startsWith("lock:Product:")).length, 1);
  assert.ok(callLog.includes("stockCard.write"));
});

test("update: a DocumentMutationBlockedError from the stock write returns its message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  setUpReturnEdit();
  const message = "ไม่สามารถลงสต็อกย้อนหลังข้ามใบเพิ่มหนี้ DN26090001 กรุณายกเลิก DN ที่เกี่ยวข้องก่อน";
  writeStockCardError = new DocumentMutationBlockedError(message);
  const result = await actions.updateCreditNote(
    "cn1",
    cnForm({ saleId: "sale-1", type: "RETURN", vatType: "NO_VAT", vatRate: "0", items: [returnLine] }),
  );
  assert.deepEqual(result, { error: message });
  assert.equal(criticalReports, 0);
});

test("update: any other failure is still reported as critical", { skip: moduleMocksUnavailable }, async () => {
  setUpReturnEdit();
  writeStockCardError = new Error("connection reset");
  const result = await actions.updateCreditNote(
    "cn1",
    cnForm({ saleId: "sale-1", type: "RETURN", vatType: "NO_VAT", vatRate: "0", items: [returnLine] }),
  );
  assert.deepEqual(result, { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
  assert.equal(criticalReports, 1);
});

// ─── 4. kept lines always get subtotalAmount recomputed ─────────────────────

test("update: a kept line gets subtotalAmount recomputed even when VAT is unchanged", { skip: moduleMocksUnavailable }, async () => {
  saleVat = { vatType: "INCLUDING_VAT", vatRate: 7 };
  cnRow.vatType = "INCLUDING_VAT";
  cnRow.vatRate = 7;
  cnRow.items = [
    {
      id: "cni-1",
      productId: "p-1",
      saleItemId: null,
      stockDisposition: "RESTOCK",
      stockDispositionNote: null,
      qty: 1,
      unitPrice: 100,
      lotItems: [],
    },
  ];
  const result = await actions.updateCreditNote("cn1", cnForm({ saleId: "sale-1", vatType: "INCLUDING_VAT", vatRate: "7" }));
  assert.deepEqual(result, { success: true });
  assert.ok(!callLog.includes("creditNoteItem.create"), "the unchanged line is kept");
  assert.equal(itemUpdates.length, 1);
  // 1 × 100 including 7% VAT → 93.46 before tax.
  assert.equal(itemUpdates[0].subtotalAmount, 93.46);
});
