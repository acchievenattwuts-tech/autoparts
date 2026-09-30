import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { SaleMutationBlockedError, assertSaleMutationAllowedInTx } from "../sale-user-error";

// updateSale takes every Product lock of its transaction in ONE sorted batch — the
// Sale's current stock products plus the old and new lines' products — before the
// in-transaction guard, the same order purchases and purchase returns use. Later
// re-locks of those rows (preloadSaleDependencies, writeStockCard) lock nothing new.
//
// Also: on edit, every kept (unchanged) line gets subtotalAmount recomputed from the
// header VAT, even when the VAT did not change.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type RawQuery = { sql: string; values: unknown[] };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return [];
          };
        }
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

/** Product row-lock batches, in call order, as the sorted id lists they lock. */
const productLockBatches = (calls: Call[]): string[][] =>
  calls
    .filter((call) => call.method === "$queryRaw")
    .map((call) => call.args as RawQuery)
    .filter((query) => /FROM "Product"/.test(query.sql) && /FOR UPDATE/.test(query.sql))
    .map((query) => query.values.map(String));

const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

// ─── assertSaleMutationAllowedInTx on its own ─────────────────────────────

test("the Sale's stock products and the extra line products are locked in one sorted batch before the guard", async () => {
  const calls: Call[] = [];
  const tx = makeClient(
    () => ({
      sale: { findMany: async () => [{ saleNo: "SA2609200001" }] },
      stockCard: {
        findMany: async (args: unknown) =>
          (args as { distinct?: unknown }).distinct ? [{ productId: "prod-3" }, { productId: "prod-1" }] : [],
      },
    }),
    calls,
  );

  await assertSaleMutationAllowedInTx(tx as never, "sale1", "update", ["prod-2", "prod-1", "prod-3"]);

  assert.deepEqual(productLockBatches(calls), [["prod-1", "prod-2", "prod-3"]]);
  const lockIndex = calls.findIndex((call) => call.method === "$queryRaw");
  const guardIndex = calls.findIndex((call) => call.method === "creditNote.findMany");
  assert.ok(lockIndex >= 0 && guardIndex > lockIndex, "the guard reads run after the lock");
});

test("without extra products (cancel) only the Sale's stock products are locked, and a block still throws", async () => {
  const calls: Call[] = [];
  const tx = makeClient(
    () => ({
      sale: { findMany: async () => [{ saleNo: "SA2609200001" }] },
      stockCard: {
        findMany: async (args: unknown) => ((args as { distinct?: unknown }).distinct ? [{ productId: "prod-1" }] : []),
      },
      creditNote: { findMany: async () => [{ id: "cn-1", cnNo: "CN26090001" }] },
    }),
    calls,
  );

  await assert.rejects(assertSaleMutationAllowedInTx(tx as never, "sale1", "cancel"), SaleMutationBlockedError);
  assert.deepEqual(productLockBatches(calls), [["prod-1"]]);
});

// ─── updateSale end-to-end with the DB and side-effect libraries module-mocked ──

const SALE_UPDATED_AT = new Date("2026-09-20T03:00:00.000Z");
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];

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
    namedExports: { ...realNotifications, dispatchOutOfStockAlerts: async () => undefined },
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
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
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

const existingSale = (vatType: string, vatRate: number) => ({
  id: "sale1",
  saleNo: "SA2609200001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-09-19T17:00:00.000Z"), // 2026-09-20 in Thailand
  customerId: "cust-1",
  quotationId: null,
  quotationRevision: null,
  updatedAt: SALE_UPDATED_AT,
  vatType,
  vatRate,
  signerName: "Tester",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Tester", signatureUrl: null },
  items: [storedItem],
  creditNotes: [],
  receipts: [],
});

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

const saleForm = (items: unknown[], vat: { vatType: string; vatRate: string }): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-20",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: vat.vatType,
    vatRate: vat.vatRate,
    items: JSON.stringify(items),
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const setSaleVat = (vatType: string, vatRate: number) => {
  dbOverrides.sale = { findUnique: async () => existingSale(vatType, vatRate) };
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
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
    sale: { findUnique: async () => existingSale("NO_VAT", 0) },
    productUnit: units,
    product: { findMany: async () => [] },
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: units,
    product: { findMany: async () => [trackedProduct("prod-1"), trackedProduct("prod-2")] },
    stockCard: {
      findMany: async (args: unknown) => ((args as { distinct?: unknown }).distinct ? [{ productId: "prod-1" }] : []),
    },
  };
});

test("updateSale locks the old and new lines' products in one sorted batch before the guard and any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  // The new line (prod-2) is listed first; the stored line (prod-1) is kept.
  const result = await updateSale(
    "sale1",
    saleForm([{ ...unchangedLine, productId: "prod-2" }, unchangedLine], { vatType: "NO_VAT", vatRate: "0" }),
  );

  assert.deepEqual(result, { success: true });
  const batches = productLockBatches(txCalls);
  assert.deepEqual(batches[0], ["prod-1", "prod-2"], "first Product lock is the full sorted union");
  for (const later of batches.slice(1)) {
    assert.ok(later.every((id) => batches[0].includes(id)), `re-lock ${later.join(",")} adds no new product`);
  }
  const firstProductLock = txCalls.findIndex(
    (call) => call.method === "$queryRaw" && /FROM "Product"/.test((call.args as RawQuery).sql),
  );
  const firstGuardRead = txCalls.findIndex((call) => call.method === "creditNote.findMany");
  const firstWrite = txCalls.findIndex((call) => WRITE_METHOD.test(call.method));
  assert.ok(firstProductLock >= 0 && firstGuardRead > firstProductLock, "the guard runs after the product lock");
  assert.ok(firstWrite > firstGuardRead, "no write before the guard");
});

test("updateSale recomputes subtotalAmount on a kept line even when VAT is unchanged", { skip: moduleMocksUnavailable }, async () => {
  setSaleVat("INCLUDING_VAT", 7);
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm([unchangedLine], { vatType: "INCLUDING_VAT", vatRate: "7" }));

  assert.deepEqual(result, { success: true });
  const itemUpdates = txCalls
    .filter((call) => call.method === "saleItem.update")
    .map((call) => (call.args as { data: Record<string, unknown> }).data);
  assert.equal(itemUpdates.length, 1);
  // 1 × 100 including 7% VAT → 93.46 before tax.
  assert.equal(itemUpdates[0].subtotalAmount, 93.46);
  assert.ok(!txCalls.some((call) => call.method === "saleItem.create"), "the unchanged line is kept");
});
