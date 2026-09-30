import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { SALE_BASE_QUANTITY_DECIMALS_ERROR, SALE_QUANTITY_DECIMALS_ERROR } from "@/lib/sale-quantity";

// E7: SaleItem.quantity is Decimal(12,4) in base units. createSale / updateSale store
// qty x unit scale with up to 4 decimals (no more Math.round), the StockCard row gets the
// same value, integer lines are written exactly as before, and the form quantity is
// limited to 2 decimals.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type StockCardWrite = { qtyOut: number; detail: string };
type AuditInput = { after?: { items?: Array<{ quantity: unknown }> } };

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
const stockCardWrites: StockCardWrite[] = [];
const audits: AuditInput[] = [];

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
      safeWriteAuditLog: async (input: AuditInput) => {
        audits.push(input);
      },
      writeAuditLogTx: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: { ...realErrorReporting, reportCriticalError: async () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SAC2609300001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      recalculateStockCard: async () => undefined,
      writeStockCard: async (_tx: unknown, input: StockCardWrite) => {
        stockCardWrites.push({ qtyOut: input.qtyOut, detail: input.detail });
        return "stock-card-id";
      },
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
    namedExports: { ...realNextServer, after: () => undefined },
  });
});

const UNITS = [
  { productId: "oil-1", name: "ลิตร", scale: 1 },
  { productId: "oil-1", name: "ลัง", scale: 12 },
  { productId: "oil-1", name: "ขวดเล็ก", scale: 0.3333 },
];

const line = (overrides: Record<string, unknown> = {}) => ({
  productId: "oil-1",
  unitName: "ลิตร",
  qty: 1,
  salePrice: 200,
  unitListPrice: 200,
  lineDiscount: 0,
  warrantyDays: 0,
  lotItems: [],
  ...overrides,
});

const saleForm = (items: unknown[], overrides: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-30",
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

const storedItem = {
  id: "item-1",
  productId: "oil-1",
  quantity: new Prisma.Decimal(1),
  salePrice: 200,
  unitListPrice: 200,
  warrantyDays: 0,
  supplierId: null,
  supplierName: null,
  moreDetail: null,
  showQty: new Prisma.Decimal(1),
  showUnitName: "ลิตร",
  product: { name: "น้ำมันเครื่อง" },
  lotItems: [] as Array<{ lotNo: string; qty: number }>,
};

/** The saved lines updateSale diffs against; a test may swap in legacy rows. */
let storedItems: Array<typeof storedItem> = [storedItem];

const existingSale = {
  id: "sale1",
  saleNo: "SAC2609300001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-09-29T17:00:00.000Z"),
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
  get items() {
    return storedItems;
  },
  creditNotes: [],
  receipts: [],
};

const createdItems = (): Array<Record<string, unknown>> =>
  txCalls
    .filter((call) => call.method === "saleItem.create")
    .map((call) => (call.args as { data: Record<string, unknown> }).data);

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  stockCardWrites.length = 0;
  audits.length = 0;
  storedItems = [storedItem];
  const trackedProduct = {
    id: "oil-1",
    avgCost: 150,
    costPrice: 150,
    salePrice: 200,
    retailPrice: 200,
    memberPrice: 200,
    inventoryTracking: "TRACKED",
    isLotControl: false,
  };
  dbOverrides = {
    // Audit snapshots read the stored line back as a Decimal(12,4), like production.
    sale: { findUnique: async () => existingSale },
    productUnit: { findMany: async () => UNITS },
    product: { findMany: async () => [{ id: "oil-1" }] },
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: { findMany: async () => UNITS },
    product: { findMany: async () => [trackedProduct] },
  };
});

test("createSale stores a fractional base quantity unrounded, with the same StockCard quantity", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm([line({ qty: 0.4 })]));

  assert.deepEqual(result, { success: true, saleId: "sale-id", saleNo: "SAC2609300001" });
  const [item] = createdItems();
  assert.equal(item.quantity, 0.4, "0.4 litre is no longer rounded to 0");
  assert.equal(item.showQty, 0.4);
  assert.equal(item.costPrice, 150);
  assert.equal(item.totalAmount, 80);
  assert.deepEqual(stockCardWrites, [{ qtyOut: 0.4, detail: "ขาย 0.40 ลิตร" }]);
});

test("createSale writes integer lines exactly as before (qty x scale, integer stock-card text)", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm([line({ qty: 2, unitName: "ลัง", salePrice: 2000, unitListPrice: 2000 }), line({ qty: 3 })]));

  assert.equal(result.success, true);
  assert.deepEqual(createdItems().map((item) => item.quantity), [24, 3]);
  assert.deepEqual(stockCardWrites, [
    { qtyOut: 24, detail: "ขาย 2 ลัง" },
    { qtyOut: 3, detail: "ขาย 3 ลิตร" },
  ]);
});

test("fractional lines keep their exact base quantity (1.5 litres was stored as 2 before E7)", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  await createSale(saleForm([line({ qty: 1.5 }), line({ qty: 0.25, unitName: "ลัง", salePrice: 2000, unitListPrice: 2000 })]));

  assert.deepEqual(createdItems().map((item) => item.quantity), [1.5, 3]);
  assert.deepEqual(stockCardWrites.map((write) => write.detail), ["ขาย 1.50 ลิตร", "ขาย 0.25 ลัง"]);
});

test("the sale form quantity accepts at most 2 decimals (Thai message, nothing written)", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm([line({ qty: 0.125 })]));

  assert.deepEqual(result, { error: SALE_QUANTITY_DECIMALS_ERROR });
  assert.deepEqual(createdItems(), []);
  assert.deepEqual(stockCardWrites, []);
});

test("a base quantity needing more than 4 decimals is refused instead of silently rounded", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  // 0.01 x 0.3333 = 0.003333 base units.
  const result = await createSale(saleForm([line({ qty: 0.01, unitName: "ขวดเล็ก" })]));

  assert.deepEqual(result, { error: SALE_BASE_QUANTITY_DECIMALS_ERROR });
  assert.deepEqual(stockCardWrites, []);
});

test("the sale audit snapshot keeps quantities as plain numbers (same JSON as the Int column)", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  await createSale(saleForm([line({ qty: 1 })]));

  const quantity = audits[0]?.after?.items?.[0]?.quantity;
  assert.equal(typeof quantity, "number");
  assert.equal(quantity, 1);
});

test("updateSale stores an added fractional line unrounded and keeps the unchanged line", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm([line({ qty: 1 }), line({ qty: 1.5 })]));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(createdItems().map((item) => item.quantity), [1.5]);
  assert.deepEqual(stockCardWrites, [{ qtyOut: 1.5, detail: "ขาย 1.50 ลิตร" }]);
});

test("updateSale applies the same 2-decimal limit", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm([line({ qty: 1.255 })]));

  assert.deepEqual(result, { error: SALE_QUANTITY_DECIMALS_ERROR });
  assert.equal(txCalls.length, 0);
});

test("updateSale: an unchanged saved line with 3 decimals never blocks the edit (owner rule)", { skip: moduleMocksUnavailable }, async () => {
  storedItems = [{ ...storedItem, quantity: new Prisma.Decimal("0.125"), showQty: new Prisma.Decimal("0.125") }];
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm([line({ qty: 0.125 }), line({ qty: 1.5 })]));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(createdItems().map((item) => item.quantity), [1.5], "only the added line is written");
});

test("updateSale: a date change rebuilds the unchanged 3-decimal line without refusing it", { skip: moduleMocksUnavailable }, async () => {
  storedItems = [{ ...storedItem, quantity: new Prisma.Decimal("0.125"), showQty: new Prisma.Decimal("0.125") }];
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm([line({ qty: 0.125 })], { saleDate: "2026-09-29" }));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(createdItems().map((item) => item.quantity), [0.125]);
  assert.deepEqual(stockCardWrites, [{ qtyOut: 0.125, detail: "ขาย 0.13 ลิตร" }]);
});
