import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// createSale / updateSale fire the real-time out-of-stock alert by comparing stock
// before the save with stock after commit: products that still had stock before are
// handed, with the sale id, to dispatchOutOfStockAlerts from after(), which alerts
// those now at zero. writeStockCard is mocked, so this also holds for backdated
// sales and edits, whose rows go through the full recalculation that never sets
// crossedToZero.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Dispatch = { productIds: string[]; saleId: string; at: Date };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") return async () => [];
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (args: unknown) => {
                calls.push({ method: `${modelName}.${method}`, args });
                if (override) return override(args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id`, count: 0 };
              };
            },
          },
        );
      },
    },
  );

const SALE_UPDATED_AT = new Date("2026-09-20T03:00:00.000Z");
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];
const afterCallbacks: Array<() => unknown> = [];
const dispatches: Dispatch[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, dbCalls),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      dispatchOutOfStockAlerts: async (productIds: string[], saleId: string, at: Date) => {
        dispatches.push({ productIds, saleId, at });
      },
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async () => undefined,
      writeAuditLogTx: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: { ...realErrorReporting, reportCriticalError: async () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SAC2609180001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      recalculateStockCard: async () => undefined,
      writeStockCard: async () => "stock-card-id",
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
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
    namedExports: { ...realAmountRemain, recalculateSaleAmountRemain: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: {
      ...realWhtReceived,
      cancelWhtReceivedForDocument: async () => undefined,
      persistWhtReceived: async () => undefined,
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: { ...realProfitFact, rebuildSaleProfitFacts: async () => undefined },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", {
    namedExports: {
      ...realNextServer,
      after: (callback: () => unknown) => {
        afterCallbacks.push(callback);
      },
    },
  });
});

const storedItem = {
  id: "item-1",
  productId: "prod-1",
  quantity: 1,
  salePrice: 100,
  unitListPrice: 100,
  warrantyDays: 0,
  supplierId: null,
  supplierName: null,
  moreDetail: null,
  showQty: 1,
  showUnitName: "ชิ้น",
  product: { name: "ไส้กรอง" },
  lotItems: [] as Array<{ lotNo: string; qty: number }>,
};

const existingSale = {
  id: "sale1",
  saleNo: "SA2609200001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-09-19T17:00:00.000Z"), // 2026-09-20 in Thailand
  customerId: "cust-1",
  quotationId: null,
  quotationRevision: null,
  updatedAt: SALE_UPDATED_AT,
  vatType: "NO_VAT",
  vatRate: 0,
  signerName: "Tester",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Tester", signatureUrl: null },
  items: [storedItem],
  creditNotes: [],
  receipts: [],
};

const unchangedLine = {
  productId: "prod-1",
  unitName: "ชิ้น",
  qty: 1,
  salePrice: 100,
  unitListPrice: 100,
  lineDiscount: 0,
  warrantyDays: 0,
  lotItems: [],
};

const saleForm = (overrides: Record<string, string> = {}, items: unknown[] = [unchangedLine]): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-20",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

/** The pre-edit read: `db.product.findMany` filtered on `stock > 0`. */
const stockReads = (): unknown[] =>
  dbCalls
    .filter((call) => call.method === "product.findMany")
    .map((call) => (call.args as { where: unknown }).where);

/** Stock before the edit, as the pre-edit read sees it. */
const stockBeforeSave = (stockByProduct: Record<string, number>) => ({
  findMany: async (args: unknown) => {
    const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
    return ids.filter((id) => (stockByProduct[id] ?? 0) > 0).map((id) => ({ id }));
  },
});

const runAfterCallbacks = async (): Promise<void> => {
  for (const callback of afterCallbacks.splice(0)) await callback();
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  afterCallbacks.length = 0;
  dispatches.length = 0;
  const units = {
    findMany: async () => [
      { productId: "prod-1", name: "ชิ้น", scale: 1 },
      { productId: "prod-2", name: "ชิ้น", scale: 1 },
    ],
  };
  const trackedProduct = (id: string) => ({
    id,
    avgCost: 50,
    costPrice: 50,
    salePrice: 100,
    retailPrice: 100,
    memberPrice: 100,
    inventoryTracking: "TRACKED",
    isLotControl: false,
  });
  dbOverrides = {
    sale: { findUnique: async () => existingSale },
    productUnit: units,
    product: stockBeforeSave({ "prod-1": 1, "prod-2": 5 }),
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: units,
    product: { findMany: async () => [trackedProduct("prod-1"), trackedProduct("prod-2")] },
  };
});

test("an edit that deducts more stock hands the products that still had stock to the alert, after commit", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({}, [{ ...unchangedLine, qty: 2 }]));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(stockReads(), [{ id: { in: ["prod-1"] }, stock: { gt: 0 } }]);
  assert.equal(dispatches.length, 0, "nothing is sent before the response");
  await runAfterCallbacks();
  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].productIds, ["prod-1"]);
  assert.equal(dispatches[0].saleId, "sale1", "the alert names the edited sale");
  assert.ok(dispatches[0].at instanceof Date);
});

test("a product already out of stock before the edit is not re-alerted", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.product = stockBeforeSave({ "prod-1": 0 });
  const { updateSale } = await import("../actions");

  // A price-only change still reverses and re-deducts the line.
  const result = await updateSale("sale1", saleForm({}, [{ ...unchangedLine, salePrice: 120, unitListPrice: 120 }]));

  assert.deepEqual(result, { success: true });
  assert.equal(stockReads().length, 1);
  await runAfterCallbacks();
  assert.deepEqual(dispatches, []);
});

test("unchanged lines deduct nothing, so there is no stock read and no alert", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({ note: "แก้หมายเหตุ" }));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(stockReads(), []);
  await runAfterCallbacks();
  assert.deepEqual(dispatches, []);
});

test("only products on added or changed lines are checked", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({}, [unchangedLine, { ...unchangedLine, productId: "prod-2", qty: 5 }]));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(stockReads(), [{ id: { in: ["prod-2"] }, stock: { gt: 0 } }]);
  await runAfterCallbacks();
  assert.deepEqual(dispatches.map((dispatch) => dispatch.productIds), [["prod-2"]]);
});

test("a sale-date change rebuilds every line, so every product is checked", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({ saleDate: "2026-09-18" }));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(stockReads(), [{ id: { in: ["prod-1"] }, stock: { gt: 0 } }]);
  await runAfterCallbacks();
  assert.deepEqual(dispatches.map((dispatch) => dispatch.productIds), [["prod-1"]]);
});

test("a failed edit sends no alert", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.sale = {
    findUnique: async () => {
      throw new Error("connection reset");
    },
  };
  const { updateSale } = await import("../actions");

  const spy = mock.method(console, "error", () => undefined);
  try {
    const result = await updateSale("sale1", saleForm({}, [{ ...unchangedLine, qty: 2 }]));
    assert.deepEqual(result, { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
  } finally {
    spy.mock.restore();
  }
  await runAfterCallbacks();
  assert.deepEqual(dispatches, []);
});

test("a failed pre-edit stock read skips the alert but never the edit", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.product = {
    findMany: async () => {
      throw new Error("pool timeout");
    },
  };
  const { updateSale } = await import("../actions");

  const warn = mock.method(console, "warn", () => undefined);
  let result: Awaited<ReturnType<typeof updateSale>> | undefined;
  try {
    result = await updateSale("sale1", saleForm({}, [{ ...unchangedLine, qty: 2 }]));
  } finally {
    warn.mock.restore();
  }

  assert.deepEqual(result, { success: true });
  assert.equal(txCalls.some((call) => call.method === "sale.update"), true);
  await runAfterCallbacks();
  assert.deepEqual(dispatches, []);
});

// ── createSale ──────────────────────────────────────────────────────────────

test("a backdated createSale hands the products that still had stock and the new sale id to the alert, after commit", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(
    saleForm({ saleDate: "2026-09-18" }, [unchangedLine, { ...unchangedLine, productId: "prod-2", qty: 5 }]),
  );

  assert.deepEqual(result, { success: true, saleId: "sale-id", saleNo: "SAC2609180001" });
  assert.deepEqual(stockReads(), [{ id: { in: ["prod-1", "prod-2"] }, stock: { gt: 0 } }]);
  assert.equal(dispatches.length, 0, "nothing is sent before the response");
  await runAfterCallbacks();
  assert.deepEqual(
    dispatches.map(({ productIds, saleId }) => ({ productIds, saleId })),
    [{ productIds: ["prod-1", "prod-2"], saleId: "sale-id" }],
  );
});

test("createSale does not alert products that were already out of stock before the sale", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.product = stockBeforeSave({});
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm({ saleDate: "2026-09-18" }));

  assert.equal(result.success, true);
  assert.equal(stockReads().length, 1);
  await runAfterCallbacks();
  assert.deepEqual(dispatches, []);
});
