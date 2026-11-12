import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// M9 (review 2026-11-12): the Shopee import stores the order number normalized (upper-case, trimmed —
// real Shopee order numbers already are, so nothing changes for them) and keeps today's idempotency:
// an order that already has a sale, ACTIVE or CANCELLED, is never imported again. Only manual keying
// may reuse a cancelled sale's order number.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

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

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: makeClient(() => dbOverrides, dbCalls), dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx) },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: { ...realNotifications, dispatchOutOfStockAlerts: async () => undefined, findProductIdsWithStock: async () => [] },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", { namedExports: { ...realAudit, safeWriteAuditLog: async () => undefined } });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", { namedExports: { ...realDocNumber, generateSaleNo: async () => "SP2611120001" } });
  const realMarketplaceQueries = await import("@/lib/marketplace/queries");
  await mock.module("@/lib/marketplace/queries", {
    namedExports: { ...realMarketplaceQueries, getMarketplaceHoldingAccountId: async () => "acc-shopee" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", { namedExports: { ...realStockCard, writeStockCard: async () => "stock-card-id" } });
  const realSaleCore = await import("@/lib/sale-core");
  await mock.module("@/lib/sale-core", { namedExports: { ...realSaleCore, resolveSalePaymentMethod: async () => "TRANSFER" } });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", { namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined } });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", { namedExports: { ...realProfitFact, rebuildSaleProfitFacts: async () => undefined } });
});

const mapping = {
  itemId: "1", modelId: "0", productId: "prod-1", productUnitId: null,
  product: {
    id: "prod-1", code: "PROD-1", name: "ไส้กรอง", saleUnitName: "ชิ้น", inventoryTracking: "TRACKED", isLotControl: false,
    units: [{ id: "prod-1-unit", name: "ชิ้น", scale: 1, isBase: true }],
  },
};

const orderImport = (orderSn: string, saleId: string | null = null) => ({
  id: "import-1", orderSn, buyerUsername: "buyer_01", orderCreatedAt: new Date("2026-11-11T17:00:00.000Z"), totalAmount: null,
  rawPayload: {
    order_sn: orderSn, order_status: "READY_TO_SHIP",
    item_list: [{ item_id: 1, model_id: 0, item_name: "ไส้กรอง", model_quantity_purchased: 1, model_discounted_price: 100 }],
  },
  importStatus: "PENDING", saleId, shopRecordId: "shop-1", returnReviewRequired: false, sale: null,
});

const duplicateChecks = (): unknown[] =>
  txCalls.filter((call) => call.method === "sale.findFirst").map((call) => (call.args as { where: unknown }).where);
const createdRefs = (): unknown[] =>
  txCalls.filter((call) => call.method === "sale.create").map((call) => (call.args as { data: { channelRefNo: unknown } }).data.channelRefNo);

const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const spy = mock.method(console, "error", () => undefined);
  try {
    return await run();
  } finally {
    spy.mock.restore();
  }
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  dbOverrides = {
    shopeeOrderImport: { findUnique: async () => orderImport("2611120ABC") },
    shopeeProductMapping: { findMany: async () => [mapping] },
  };
  txOverrides = {
    shopeeOrderImport: { updateMany: async () => ({ count: 1 }) },
    sale: { create: async () => ({ id: "sale-shopee" }) },
    product: {
      findMany: async () => [{ id: "prod-1", avgCost: 50, costPrice: 50, inventoryTracking: "TRACKED", warrantyDays: 0, isLotControl: false }],
    },
  };
});

test("a Shopee order number is stored as Shopee sends it (already upper-case) and checked against every sale", { skip: moduleMocksUnavailable }, async () => {
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");
  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });
  assert.deepEqual(result, { ok: true, saleId: "sale-shopee", saleNo: "SP2611120001" });
  // Same check as before M9: no status filter, so a CANCELLED sale still counts.
  assert.deepEqual(duplicateChecks(), [{ channel: "SHOPEE", channelRefNo: "2611120ABC" }]);
  assert.deepEqual(createdRefs(), ["2611120ABC"]);
});

test("an order whose sale was cancelled is still not imported again", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.sale = {
    findFirst: async () => ({ id: "sale-cancelled", saleNo: "SP2611100007" }),
    create: async () => ({ id: "sale-shopee" }),
  };
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");
  const result = await quietly(() => createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" }));
  assert.deepEqual(result, { ok: false, error: "ออเดอร์นี้มีบิล Shopee อยู่แล้ว (SP2611100007)" });
  assert.deepEqual(createdRefs(), []);
});

test("an import already linked to a sale is refused before any write, as before", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.shopeeOrderImport = { findUnique: async () => orderImport("2611120ABC", "sale-old") };
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");
  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });
  assert.deepEqual(result, { ok: false, error: "ออเดอร์นี้สร้างบิลไปแล้ว" });
  assert.deepEqual(txCalls, []);
});

test("an order number with stray spaces or lower case is normalized for the check and the write", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.shopeeOrderImport = { findUnique: async () => orderImport(" 2611120abc ") };
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");
  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });
  assert.equal(result.ok, true);
  assert.deepEqual(duplicateChecks(), [{ channel: "SHOPEE", channelRefNo: "2611120ABC" }]);
  assert.deepEqual(createdRefs(), ["2611120ABC"]);
});

test("a concurrent ACTIVE sale caught by the M9 index gives a Thai message, not the database error", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.sale = {
    create: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002", clientVersion: "test",
        meta: { driverAdapterError: { cause: { originalMessage: "duplicate key value violates unique constraint \"Sale_active_channel_ref_key\"" } } },
      });
    },
  };
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");
  const result = await quietly(() => createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" }));
  assert.deepEqual(result, { ok: false, error: "ออเดอร์นี้มีบิล Shopee อยู่แล้ว" });
});
