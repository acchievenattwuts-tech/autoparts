import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Shopee order import: the sale is dated on the Shopee order date, so an order
// approved later is often backdated. The out-of-stock alert therefore compares
// stock before the import with stock after commit (like the admin sale form):
// tracked products that still had stock are handed, with the new sale id, to
// dispatchOutOfStockAlerts, which alerts those now at zero. writeStockCard is
// mocked, so nothing here depends on its crossedToZero flag.

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Dispatch = { productIds: string[]; saleId: string };

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
      dispatchOutOfStockAlerts: async (productIds: string[], saleId: string) => {
        dispatches.push({ productIds, saleId });
      },
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, safeWriteAuditLog: async () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SP2609150001" },
  });
  const realMarketplaceQueries = await import("@/lib/marketplace/queries");
  await mock.module("@/lib/marketplace/queries", {
    namedExports: { ...realMarketplaceQueries, getMarketplaceHoldingAccountId: async () => "acc-shopee" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, writeStockCard: async () => "stock-card-id" },
  });
  const realSaleCore = await import("@/lib/sale-core");
  await mock.module("@/lib/sale-core", {
    namedExports: { ...realSaleCore, resolveSalePaymentMethod: async () => "TRANSFER" },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: { ...realProfitFact, rebuildSaleProfitFacts: async () => undefined },
  });
});

const mapping = (itemId: string, productId: string, inventoryTracking: string) => ({
  itemId,
  modelId: "0",
  productId,
  productUnitId: null,
  product: {
    id: productId,
    code: productId.toUpperCase(),
    name: `สินค้า ${productId}`,
    saleUnitName: "ชิ้น",
    inventoryTracking,
    isLotControl: false,
    units: [{ id: `${productId}-unit`, name: "ชิ้น", scale: 1, isBase: true }],
  },
});

const orderImport = {
  id: "import-1",
  orderSn: "2609150ABC",
  buyerUsername: "buyer_01",
  // Ordered three days before approval: the sale is backdated to this date.
  orderCreatedAt: new Date("2026-09-14T17:00:00.000Z"),
  totalAmount: null,
  rawPayload: {
    order_sn: "2609150ABC",
    order_status: "READY_TO_SHIP",
    item_list: [
      { item_id: 1, model_id: 0, item_name: "ไส้กรอง", model_quantity_purchased: 1, model_discounted_price: 100 },
      { item_id: 2, model_id: 0, item_name: "ค่าบริการ", model_quantity_purchased: 1, model_discounted_price: 50 },
    ],
  },
  importStatus: "PENDING",
  saleId: null,
  shopRecordId: "shop-1",
  returnReviewRequired: false,
  sale: null,
};

/** The pre-import read: `db.product.findMany` filtered on `stock > 0`. */
const stockReads = (): unknown[] =>
  dbCalls
    .filter((call) => call.method === "product.findMany")
    .map((call) => (call.args as { where: unknown }).where);

const stockBeforeImport = (stockByProduct: Record<string, number>) => ({
  findMany: async (args: unknown) => {
    const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
    return ids.filter((id) => (stockByProduct[id] ?? 0) > 0).map((id) => ({ id }));
  },
});

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  dispatches.length = 0;
  dbOverrides = {
    shopeeOrderImport: { findUnique: async () => orderImport },
    shopeeProductMapping: {
      findMany: async () => [mapping("1", "prod-1", "TRACKED"), mapping("2", "prod-svc", "NON_TRACKED")],
    },
    product: stockBeforeImport({ "prod-1": 1, "prod-svc": 3 }),
  };
  txOverrides = {
    shopeeOrderImport: { updateMany: async () => ({ count: 1 }) },
    sale: { create: async () => ({ id: "sale-shopee" }) },
    product: {
      findMany: async () => [
        { id: "prod-1", avgCost: 50, costPrice: 50, inventoryTracking: "TRACKED", warrantyDays: 0, isLotControl: false },
        { id: "prod-svc", avgCost: 0, costPrice: 0, inventoryTracking: "NON_TRACKED", warrantyDays: 0, isLotControl: false },
      ],
    },
  };
});

test("a backdated Shopee import hands the tracked products that still had stock and the new sale id to the alert", { skip: moduleMocksUnavailable }, async () => {
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");

  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });

  assert.deepEqual(result, { ok: true, saleId: "sale-shopee", saleNo: "SP2609150001" });
  // Only the tracked line is checked; the non-tracked service line never deducts stock.
  assert.deepEqual(stockReads(), [{ id: { in: ["prod-1"] }, stock: { gt: 0 } }]);
  assert.deepEqual(dispatches, [{ productIds: ["prod-1"], saleId: "sale-shopee" }]);
});

test("a Shopee import does not alert products already out of stock before it", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.product = stockBeforeImport({});
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");

  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });

  assert.equal(result.ok, true);
  assert.equal(stockReads().length, 1);
  assert.deepEqual(dispatches, []);
});

test("a failed Shopee import sends no alert", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.shopeeOrderImport = { updateMany: async () => ({ count: 0 }) };
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");

  const error = mock.method(console, "error", () => undefined);
  let result: Awaited<ReturnType<typeof createSaleFromShopeeOrder>> | undefined;
  try {
    result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });
  } finally {
    error.mock.restore();
  }

  assert.deepEqual(result, { ok: false, error: "ออเดอร์นี้ถูกสร้างบิลหรือถูกส่งเข้า review แล้ว" });
  assert.deepEqual(dispatches, []);
});

test("a Shopee sale is posted on the approval date as a date-only Thai start of day", { skip: moduleMocksUnavailable }, async () => {
  const { getThailandDateKey, parseDateOnlyToDate } = await import("@/lib/th-date");
  const { createSaleFromShopeeOrder } = await import("../services/create-sale");

  const result = await createSaleFromShopeeOrder({ orderImportId: "import-1", approverUserId: "user-1" });

  assert.equal(result.ok, true);
  const saleCreate = txCalls.find((call) => call.method === "sale.create")?.args as { data: { saleDate: Date } };
  // A time-of-day saleDate would sort after same-day stock rows and block a same-day Supplier DN.
  assert.equal(saleCreate.data.saleDate.getTime(), parseDateOnlyToDate(getThailandDateKey()).getTime());
});
