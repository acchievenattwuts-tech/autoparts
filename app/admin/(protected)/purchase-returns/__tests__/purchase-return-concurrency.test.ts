import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// cancelPurchaseReturn / updatePurchaseReturn: the status check before the
// transaction is only a fast path. Inside the transaction the PurchaseReturn row is
// locked FIRST and its status re-read, so a concurrent cancel that committed after
// the pre-check stops a second cancel (no second lot-balance reversal) and an update
// (no RETURN_OUT rows recreated on a cancelled return) before any write.
//
// Also: on edit, every kept (unchanged) line gets subtotalAmount recomputed from the
// header VAT, even when the VAT did not change.
//
// R14(c): the edit form sends the updatedAt it loaded; after the row lock the action
// rejects a save when the document changed meanwhile (optimistic concurrency).
// R2: only the RETURN_OUT rows the edit deletes are checked against a later ACTIVE DN.
//
// The real document-mutation-guard and purchase-user-error run here; only the
// database and side-effect modules are faked.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

let callLog: string[] = [];
let criticalReports = 0;
let preReadStatus: string;
/** Status the locked row shows inside the transaction; a committed cancel flips it. */
let statusInTx: string;
let itemUpdates: Array<Record<string, unknown>> = [];
const LOADED_UPDATED_AT = new Date("2026-09-10T03:00:00.000Z");
/** updatedAt the locked row shows inside the transaction. */
let updatedAtInTx: Date;
/** A later ACTIVE supplier DN on p-1 (the SKU of the stored RETURN_OUT row). */
let laterDebitActive = false;

const record = (entry: string) => {
  callLog.push(entry);
};

const fakeTx: FakeTx = {
  // Month lock (lib/period-lock.ts): no month is declared here — see purchase-return-period-lock.test.ts.
  $executeRaw: async () => 0,
  profitDistribution: { findMany: async () => [] },
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return [{ status: statusInTx }];
  },
  // Guard reads (PurchaseReturn branch of the document mutation guard).
  purchaseReturn: {
    findMany: async () => [],
    findUnique: async () => ({ updatedAt: updatedAtInTx }),
    update: async (args: unknown) => {
      const { data } = args as { data: { status?: string } };
      record(data.status ? `purchaseReturn.update:${data.status}` : "purchaseReturn.update");
      if (data.status) statusInTx = data.status;
      return {};
    },
  },
  supplierPaymentItem: {
    findMany: async () => {
      record("guard:SupplierPaymentItem");
      return [];
    },
  },
  supplierDebitNote: {
    findMany: async (args: unknown) =>
      laterDebitActive && (args as { where?: { status?: string } }).where?.status === "ACTIVE"
        ? [{ id: "dn-1", debitNo: "SDN26090001" }]
        : [],
  },
  stockCard: {
    findMany: async (args: unknown) => {
      const { where = {} } = args as { where?: Record<string, unknown> };
      if (!laterDebitActive) return [];
      if (where.source === "SUPPLIER_DEBIT") {
        return [{ productId: "p-1", docNo: "SDN26090001", docDate: new Date("2026-09-28T17:00:00.000Z"), sorder: 9, valuationEpoch: 1 }];
      }
      return where.docNo === "PR26090001"
        ? [{ productId: "p-1", docNo: "PR26090001", docDate: new Date("2026-09-10T00:00:00.000Z"), sorder: 2, valuationEpoch: 0 }]
        : [];
    },
    deleteMany: async () => {
      record("stockCard.deleteMany");
      return { count: 1 };
    },
  },
  productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] },
  product: {
    findMany: async () => [
      { id: "p-1", avgCost: 50, costPrice: 50, inventoryTracking: "TRACKED", isLotControl: false },
    ],
  },
  purchaseReturnItem: {
    update: async (args: unknown) => {
      const { data } = args as { data: Record<string, unknown> };
      record("purchaseReturnItem.update");
      itemUpdates.push(data);
      return {};
    },
    create: async () => {
      record("purchaseReturnItem.create");
      return { id: "pri-new" };
    },
    deleteMany: async () => {
      record("purchaseReturnItem.deleteMany");
      return { count: 1 };
    },
  },
};

const purchaseReturnRow = () => ({
  id: "pr1",
  returnNo: "PR26090001",
  status: preReadStatus,
  type: "RETURN",
  settlementType: "SUPPLIER_CREDIT",
  refundMethod: null,
  returnDate: new Date("2026-09-10T00:00:00.000Z"),
  purchaseId: null,
  purchase: null,
  claimId: null,
  supplierId: "sup-1",
  supplier: null,
  cashBankAccountId: null,
  totalAmount: 100,
  amountRemain: 100,
  subtotalAmount: 93.46,
  vatAmount: 6.54,
  vatType: "INCLUDING_VAT",
  vatRate: 7,
  note: null,
  cancelNote: null,
  cancelledAt: null,
  items: [{ id: "pri-1", productId: "p-1", qty: 2, costPrice: 50, lotItems: [] }],
});

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  if (moduleMocksUnavailable) return;
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
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        record("stockCard.write");
        return "sc-1";
      },
      recalculateStockCard: async (_tx: unknown, productId: string) => {
        record(`stockCard.recalculate:${productId}`);
      },
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLotControl,
      reversePurchaseReturnLotBalance: async (_tx: unknown, itemId: string) => {
        record(`lot.reverse:${itemId}`);
      },
      writePurchaseReturnLots: async () => undefined,
      writeStockMovementLots: async () => undefined,
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => {
        record("cashBank.clear");
      },
      replaceCashBankSourceMovements: async () => {
        record("cashBank.replace");
      },
    },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: {
      ...realPayments,
      clearDocumentPayments: async () => {
        record("documentPayment.clear");
      },
      replaceDocumentPayments: async () => {
        record("documentPayment.replace");
      },
    },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: {
      ...realAmountRemain,
      recalculatePurchaseReturnAmountRemain: async () => {
        record("amountRemain.recalculate");
      },
    },
  });
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", {
    namedExports: {
      ...realClaimStock,
      reverseClaimStockMovements: async () => {
        record("claimStock.reverse");
      },
      writeClaimStockMovement: async () => {
        record("claimStock.write");
        return "movement-1";
      },
    },
  });
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: {
        purchaseReturn: { findUnique: async () => purchaseReturnRow() },
        // Pre-check reads: getActiveSupplierPaymentRefs and the fast-path guard.
        supplierPaymentItem: { findMany: async () => [] },
        documentPayment: { findMany: async () => [] },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  actions = await import("../actions");
});

beforeEach(() => {
  callLog = [];
  criticalReports = 0;
  preReadStatus = "ACTIVE";
  statusInTx = "ACTIVE";
  itemUpdates = [];
  updatedAtInTx = LOADED_UPDATED_AT;
  laterDebitActive = false;
});

const cancelForm = () => {
  const form = new FormData();
  form.set("returnId", "pr1");
  return form;
};

const updateForm = () => {
  const form = new FormData();
  form.set("returnDate", "2026-09-10");
  form.set("supplierId", "sup-1");
  form.set("type", "RETURN");
  form.set("settlementType", "SUPPLIER_CREDIT");
  form.set("vatType", "INCLUDING_VAT");
  form.set("vatRate", "7");
  // V5: a VAT return names the supplier's credit note.
  form.set("taxInvoiceNo", "CN-SUP-0001");
  form.set("taxInvoiceDate", "2026-09-10");
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 2, costPrice: 50 }]));
  form.set("updatedAt", LOADED_UPDATED_AT.toISOString());
  return form;
};

const LOCK_AND_GUARD = ["lock:PurchaseReturn:pr1", "lock:Product:p-1", "guard:SupplierPaymentItem"];

test("cancel locks the row, re-checks it, then locks products and re-runs the guard before any write", { skip: moduleMocksUnavailable }, async () => {
  const result = await actions.cancelPurchaseReturn(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [
    ...LOCK_AND_GUARD,
    "lot.reverse:pri-1",
    "stockCard.deleteMany",
    "stockCard.recalculate:p-1",
    "cashBank.clear",
    "documentPayment.clear",
    "purchaseReturn.update:CANCELLED",
  ]);
  assert.equal(criticalReports, 0);
});

test("a return cancelled after the pre-check stops cancel at the lock, with no second lot reversal", { skip: moduleMocksUnavailable }, async () => {
  statusInTx = "CANCELLED";
  const result = await actions.cancelPurchaseReturn(cancelForm());
  assert.deepEqual(result, { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(callLog, ["lock:PurchaseReturn:pr1"], "nothing is touched after the status re-check");
  assert.equal(criticalReports, 0, "a lost race is a user message, not a critical alert");
});

test("two cancels that both passed the pre-check reverse the lot balances once", { skip: moduleMocksUnavailable }, async () => {
  // The pre-read stays ACTIVE for both; the first commit flips the locked row to CANCELLED.
  const first = await actions.cancelPurchaseReturn(cancelForm());
  const second = await actions.cancelPurchaseReturn(cancelForm());
  assert.deepEqual(first, { success: true });
  assert.deepEqual(second, { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.equal(callLog.filter((entry) => entry.startsWith("lot.reverse:")).length, 1);
  assert.equal(callLog.filter((entry) => entry === "stockCard.recalculate:p-1").length, 1);
  assert.equal(callLog.at(-1), "lock:PurchaseReturn:pr1");
  assert.equal(criticalReports, 0);
});

test("an update racing a committed cancel stops at the lock and recreates no RETURN_OUT row", { skip: moduleMocksUnavailable }, async () => {
  statusInTx = "CANCELLED";
  const result = await actions.updatePurchaseReturn("pr1", updateForm());
  assert.deepEqual(result, { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" });
  assert.deepEqual(callLog, ["lock:PurchaseReturn:pr1"]);
  assert.ok(!callLog.includes("stockCard.write"));
  assert.equal(criticalReports, 0);
});

test("the fast path still rejects an already-cancelled return without opening a transaction", { skip: moduleMocksUnavailable }, async () => {
  preReadStatus = "CANCELLED";
  assert.deepEqual(await actions.cancelPurchaseReturn(cancelForm()), { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(await actions.updatePurchaseReturn("pr1", updateForm()), {
    error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้",
  });
  assert.deepEqual(callLog, []);
});

test("update locks and re-checks first, and recomputes subtotalAmount on a kept line even when VAT is unchanged", { skip: moduleMocksUnavailable }, async () => {
  const result = await actions.updatePurchaseReturn("pr1", updateForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog.slice(0, LOCK_AND_GUARD.length), LOCK_AND_GUARD);
  // The line is unchanged, so it is kept: no stock rewrite, only the header sync.
  assert.ok(!callLog.includes("stockCard.write"));
  assert.ok(!callLog.includes("purchaseReturnItem.create"));
  assert.equal(itemUpdates.length, 1);
  // 2 × 50 = 100 including 7% VAT → 93.46 before tax.
  assert.equal(itemUpdates[0].subtotalAmount, 93.46);
  assert.equal(criticalReports, 0);
});

const STALE_MESSAGE = "เอกสารถูกแก้ไขโดยผู้อื่นระหว่างที่คุณแก้ไข กรุณาโหลดหน้าใหม่";

test("an update whose form updatedAt is stale stops right after the row lock", { skip: moduleMocksUnavailable }, async () => {
  updatedAtInTx = new Date("2026-09-10T03:05:00.000Z"); // saved by someone else after the form loaded
  const result = await actions.updatePurchaseReturn("pr1", updateForm());
  assert.deepEqual(result, { error: STALE_MESSAGE });
  assert.deepEqual(callLog, ["lock:PurchaseReturn:pr1"], "nothing is locked or written after the stale check");
  assert.equal(criticalReports, 0);
});

test("an update without the loaded updatedAt is treated as stale", { skip: moduleMocksUnavailable }, async () => {
  const form = updateForm();
  form.delete("updatedAt");
  assert.deepEqual(await actions.updatePurchaseReturn("pr1", form), { error: STALE_MESSAGE });
  assert.equal(criticalReports, 0);
});

test("changing the line of a SKU with a later active DN is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  laterDebitActive = true;
  const form = updateForm();
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 1, costPrice: 50 }]));
  const result = await actions.updatePurchaseReturn("pr1", form);
  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.deepEqual(callLog, LOCK_AND_GUARD, "no claim reversal, stock delete or item write");
  assert.equal(criticalReports, 0);
});

test("a header-only edit saves even with the later active DN", { skip: moduleMocksUnavailable }, async () => {
  laterDebitActive = true;
  const form = updateForm();
  form.set("note", "แก้ไขเฉพาะหมายเหตุ");
  assert.deepEqual(await actions.updatePurchaseReturn("pr1", form), { success: true });
  assert.ok(!callLog.includes("stockCard.deleteMany"));
  assert.equal(criticalReports, 0);
});
