import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { ITEM_BASE_QUANTITY_DECIMALS_ERROR, ITEM_QUANTITY_DECIMALS_ERROR } from "@/lib/item-quantity";

// ก5: PurchaseItem.quantity is Decimal(12,4) in base units. createPurchase / updatePurchase
// store qty x unit scale with up to 4 decimals (no more Math.round), the StockCard row gets
// the same value, integer lines are written exactly as before, the form quantity is limited
// to 2 decimals, and only lines the user added or changed are validated.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type StockCardWrite = { qtyIn: number; detail: string };
type AuditInput = { after?: { items?: Array<{ quantity: unknown }> } };
type Row = Record<string, unknown>;

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") return async () => [{ status: "ACTIVE" }];
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
                return { id: `${modelName}-id`, count: 1 };
              };
            },
          },
        );
      },
    },
  );

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const stockCardWrites: StockCardWrite[] = [];
const audits: AuditInput[] = [];
const criticalErrors: unknown[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, []),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
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
      safeWriteAuditLog: async (input: AuditInput) => {
        audits.push(input);
      },
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown) => {
        criticalErrors.push(error);
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generatePurchaseNo: async () => "RRC26093000001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      recalculateStockCardMany: async () => undefined,
      writeStockCard: async (_tx: unknown, input: StockCardWrite) => {
        stockCardWrites.push({ qtyIn: input.qtyIn, detail: input.detail });
        return "stock-card-id";
      },
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reversePurchaseLotBalance: async () => undefined },
  });
  const realPurchaseLast = await import("@/lib/product-purchase-last");
  await mock.module("@/lib/product-purchase-last", {
    namedExports: { ...realPurchaseLast, refreshProductPurchaseLastFields: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, replaceDocumentPayments: async () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

const UNITS = [
  { productId: "oil-1", name: "ลิตร", scale: 1 },
  { productId: "oil-1", name: "ลัง", scale: 12 },
  { productId: "oil-1", name: "ขวดเล็ก", scale: 0.3333 },
  { productId: "oil-1", name: "ถ้วยตวง", scale: 0.125 },
];

const line = (overrides: Row = {}): Row => ({
  productId: "oil-1", unitName: "ลิตร", qty: 1, costPrice: 150, lotItems: [], ...overrides,
});

const purchaseForm = (items: Row[], overrides: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-09-30",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

/** A saved line as updatePurchase / the audit snapshot read it back: quantity is a Decimal(12,4). */
const savedLine = (id: string, quantity: string, showQty: string, unitName = "ลิตร", unitScale = 1): Row => ({
  id, lineNo: 1, productId: "oil-1", supplierId: "sup-1", quantity: new Prisma.Decimal(quantity), costPrice: 150,
  landedCost: 0, totalAmount: 150, subtotalAmount: 150, moreDetail: null, lotItems: [],
  showQty: new Prisma.Decimal(showQty), showUnitName: unitName, unitScale,
  product: { code: "OIL-1", name: "น้ำมันเครื่อง" },
});

let savedItems: Row[] = [];

const existingPurchase = (): Row => ({
  id: "po1", purchaseNo: "RRC26093000001", status: "ACTIVE", supplierId: "sup-1", supplier: null,
  purchaseDate: new Date("2026-09-29T17:00:00.000Z"), // 2026-09-30 in Thailand
  purchaseType: "CREDIT_PURCHASE", shippingFee: 0, discount: 0,
  items: savedItems, purchaseReturns: [], supplierPaymentItems: [],
});

const createdQuantities = (): unknown[] =>
  txCalls.flatMap((call) => {
    if (call.method === "purchaseItem.create") return [(call.args as { data: Row }).data.quantity];
    if (call.method === "purchaseItem.createMany") return (call.args as { data: Row[] }).data.map((row) => row.quantity);
    return [];
  });

const stockCardDrafts = (): Array<{ qtyIn: string; detail: unknown }> =>
  txCalls
    .filter((call) => call.method === "stockCard.createMany")
    .flatMap((call) => (call.args as { data: Row[] }).data.map((row) => ({ qtyIn: String(row.qtyIn), detail: row.detail })));

beforeEach(() => {
  txCalls.length = 0;
  stockCardWrites.length = 0;
  audits.length = 0;
  criticalErrors.length = 0;
  savedItems = [savedLine("item-1", "1", "1")];
  const units = { findMany: async () => UNITS };
  dbOverrides = {
    purchase: { findUnique: async () => existingPurchase() },
    productUnit: units,
  };
  txOverrides = {
    productUnit: units,
    product: {
      findMany: async () => [{ id: "oil-1", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false }],
    },
    purchase: { create: async () => ({ id: "purchase-new" }) },
    stockCard: { groupBy: async () => [] },
  };
});

test("createPurchase stores 20.5 base units exactly, with the same StockCard quantity", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm([line({ qty: 20.5 })]));

  assert.equal(result.success, true, result.error);
  assert.deepEqual(createdQuantities(), [20.5], "20.5 litres is no longer rounded to 21");
  assert.deepEqual(stockCardWrites, [{ qtyIn: 20.5, detail: "ซื้อเข้า 20.50 ลิตร" }]);
});

test("createPurchase writes integer lines exactly as before (qty x scale, integer stock-card text)", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm([line({ qty: 2, unitName: "ลัง", costPrice: 1800 }), line({ qty: 3 })]));

  assert.equal(result.success, true, result.error);
  assert.deepEqual(createdQuantities(), [24, 3]);
  assert.deepEqual(stockCardWrites, [
    { qtyIn: 24, detail: "ซื้อเข้า 2 ลัง" },
    { qtyIn: 3, detail: "ซื้อเข้า 3 ลิตร" },
  ]);
});

test("the purchase form quantity accepts at most 2 decimals (Thai message, nothing written)", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  const result = await createPurchase(purchaseForm([line({ qty: 20.125 })]));

  assert.deepEqual(result, { error: ITEM_QUANTITY_DECIMALS_ERROR });
  assert.equal(txCalls.length, 0);
});

test("a base quantity needing more than 4 decimals is refused instead of silently rounded", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  // 0.01 x 0.3333 = 0.003333 base units.
  const result = await createPurchase(purchaseForm([line({ qty: 0.01, unitName: "ขวดเล็ก" })]));

  assert.deepEqual(result, { error: ITEM_BASE_QUANTITY_DECIMALS_ERROR });
  assert.deepEqual(stockCardWrites, []);
});

test("the purchase audit snapshot keeps quantities as plain numbers (same JSON as the Int column)", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");

  await createPurchase(purchaseForm([line({ qty: 1 })]));

  const quantity = audits[0]?.after?.items?.[0]?.quantity;
  assert.equal(typeof quantity, "number");
  assert.equal(quantity, 1);
});

test("updatePurchase: an unchanged saved line with 3 decimals never blocks; an added 20.5 line is stored exactly", { skip: moduleMocksUnavailable }, async () => {
  savedItems = [savedLine("item-1", "0.125", "0.125")];
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm([line({ qty: 0.125 }), line({ qty: 20.5 })]));

  assert.deepEqual(result, { success: true }, String(criticalErrors[0]));
  assert.deepEqual(createdQuantities(), [20.5], "only the added line is written");
  assert.deepEqual(stockCardDrafts(), [{ qtyIn: "20.5", detail: "ซื้อเข้า 20.50 ลิตร" }]);
});

test("updatePurchase refuses a changed line with more than 2 decimals before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm([line({ qty: 1.255 })]));

  assert.deepEqual(result, { error: ITEM_QUANTITY_DECIMALS_ERROR });
  assert.equal(txCalls.length, 0);
});

test("a date change rebuilds an unchanged saved line without refusing its 5-decimal base quantity", { skip: moduleMocksUnavailable }, async () => {
  // 0.25 x 0.125 = 0.03125 base units; the saved row holds the column-rounded 0.0313 (18.75 per cup = 150 per base).
  savedItems = [savedLine("item-1", "0.0313", "0.25", "ถ้วยตวง", 0.125)];
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm([line({ qty: 0.25, unitName: "ถ้วยตวง", costPrice: 18.75 })], { purchaseDate: "2026-09-29" }));

  assert.deepEqual(result, { success: true }, result.error ?? String(criticalErrors[0]));
  assert.deepEqual(createdQuantities(), [0.0313]);

  // The same quantity on a line the user added is refused, not silently rounded.
  savedItems = [];
  const added = await updatePurchase("po1", purchaseForm([line({ qty: 0.25, unitName: "ถ้วยตวง", costPrice: 18.75 })]));
  assert.deepEqual(added, { error: ITEM_BASE_QUANTITY_DECIMALS_ERROR });
});
