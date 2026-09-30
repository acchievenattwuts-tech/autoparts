import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Owner decisions V1 (option ข) / V2 / V5 through createPurchase / updatePurchase (database module-mocked):
// - NO_VAT, recoverable EXCLUDING_VAT and non-recoverable INCLUDING_VAT write the same StockCard
//   priceIn / landedCost and PurchaseItem landed cost as before V2 (golden values of the pre-V2 formula).
// - A recoverable INCLUDING_VAT purchase goes to stock at its pre-VAT cost (owner example:
//   10 × 107 + shipping 10.70 → 1,010.00, i.e. landed −60.00).
// - A non-recoverable EXCLUDING_VAT purchase goes to stock at its net: the VAT is cost
//   (10 × 100 + shipping 10 → 1,080.70, i.e. landed +80.70).
// - A VAT change that moves the cost base rewrites and replays the StockCard rows; one that
//   does not (both sides priced as entered) leaves stock untouched, as before.
// - A VAT purchase needs the tax invoice number and date (Thai message, nothing written).

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Row = Record<string, unknown>;
type StockCardWrite = { qtyIn: number; priceIn: number; landedCost: number };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") {
          return async (strings: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
            const query = Array.isArray(strings) ? Prisma.sql(strings as TemplateStringsArray, ...values) : strings;
            calls.push({ method: "$executeRaw", args: query });
            return 0;
          };
        }
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
const criticalErrors: unknown[] = [];
let registeredFrom: string | null = null;

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
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN", permissions: [] } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined },
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
    namedExports: { ...realDocNumber, generatePurchaseNo: async () => "RR26093000001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      recalculateStockCardMany: async () => undefined,
      writeStockCard: async (_tx: unknown, input: StockCardWrite) => {
        stockCardWrites.push({ qtyIn: input.qtyIn, priceIn: input.priceIn, landedCost: input.landedCost });
        return "stock-card-id";
      },
    },
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
];

const siteContent = { findUnique: async () => (registeredFrom === null ? null : { value: registeredFrom }) };

beforeEach(() => {
  txCalls.length = 0;
  stockCardWrites.length = 0;
  criticalErrors.length = 0;
  registeredFrom = null;
  const units = { findMany: async () => UNITS };
  dbOverrides = { productUnit: units, siteContent };
  txOverrides = {
    productUnit: units,
    siteContent,
    product: {
      findMany: async () => [{ id: "oil-1", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false }],
    },
    purchase: { create: async () => ({ id: "purchase-new" }) },
    stockCard: { groupBy: async () => [] },
  };
});

const purchaseForm = (items: Row[], fields: Record<string, string>): FormData => {
  const formData = new FormData();
  const all: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-09-30",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items),
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) formData.set(key, value);
  return formData;
};

const TWO_LINES: Row[] = [
  { productId: "oil-1", unitName: "ลัง", qty: 2, costPrice: 1800, lotItems: [] },
  { productId: "oil-1", unitName: "ลิตร", qty: 3, costPrice: 150, lotItems: [] },
];
const TAX_INVOICE = { taxInvoiceNo: "IV-2609-001", taxInvoiceDate: "2026-09-30" };

const createdItemLanded = (): unknown[] =>
  txCalls.filter((call) => call.method === "purchaseItem.create").map((call) => (call.args as { data: Row }).data.landedCost);

// Pre-V2 formula on these lines: shipping 10.70 − discount 5 = 5.70 split by 3,600 : 450 → 5.07 / 0.63.
const PRE_V2_STOCK_WRITES: StockCardWrite[] = [
  { qtyIn: 24, priceIn: 150, landedCost: 5.07 },
  { qtyIn: 3, priceIn: 150, landedCost: 0.63 },
];

test("golden: NO_VAT, recoverable EXCLUDING_VAT and non-recoverable INCLUDING_VAT write the pre-V2 StockCard values", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");
  const cases: Array<{ fields: Record<string, string>; registered: string | null }> = [
    { fields: { vatType: "NO_VAT", vatRate: "0" }, registered: null },
    { fields: { vatType: "NO_VAT", vatRate: "0" }, registered: "2026-01-01" },
    { fields: { vatType: "EXCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }, registered: "2026-01-01" },
    { fields: { vatType: "INCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }, registered: null },
    // Registered only after the tax invoice date: the VAT is still cost.
    { fields: { vatType: "INCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }, registered: "2026-10-01" },
  ];
  for (const { fields, registered } of cases) {
    txCalls.length = 0;
    stockCardWrites.length = 0;
    registeredFrom = registered;
    const result = await createPurchase(purchaseForm(TWO_LINES, { shippingFee: "10.7", discount: "5", ...fields }));
    assert.equal(result.success, true, `${JSON.stringify(fields)}: ${result.error ?? String(criticalErrors[0])}`);
    assert.deepEqual(stockCardWrites, PRE_V2_STOCK_WRITES, JSON.stringify({ fields, registered }));
    assert.deepEqual(createdItemLanded(), [5.07 / 2, 0.63 / 3]);
  }
});

test("golden: recoverable INCLUDING_VAT — 10 × 107 + shipping 10.70 goes to stock at 1,010.00 (landed −60.00)", { skip: moduleMocksUnavailable }, async () => {
  registeredFrom = "2026-09-01";
  const { createPurchase } = await import("../actions");
  const result = await createPurchase(purchaseForm(
    [{ productId: "oil-1", unitName: "ลิตร", qty: 10, costPrice: 107, lotItems: [] }],
    { vatType: "INCLUDING_VAT", vatRate: "7", shippingFee: "10.7", ...TAX_INVOICE },
  ));
  assert.equal(result.success, true, result.error ?? String(criticalErrors[0]));
  assert.deepEqual(stockCardWrites, [{ qtyIn: 10, priceIn: 107, landedCost: -60 }]);
  assert.deepEqual(createdItemLanded(), [-6]);
  const header = txCalls.find((call) => call.method === "purchase.create");
  const data = (header?.args as { data: Row }).data;
  assert.deepEqual(
    { subtotalAmount: data.subtotalAmount, vatAmount: data.vatAmount, netAmount: data.netAmount },
    { subtotalAmount: 1010, vatAmount: 70.7, netAmount: 1080.7 },
    "the payable stays VAT-inclusive; only the stock cost excludes the VAT",
  );
  assert.equal(data.taxInvoiceNo, "IV-2609-001");
  assert.deepEqual(data.taxInvoiceDate, parseDateOnlyToDate("2026-09-30"));
});

test("golden: non-recoverable EXCLUDING_VAT puts the VAT into stock cost (net 1,080.70 → landed +80.70)", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");
  // Not VAT-registered, and registered only after the tax invoice date: both leave the VAT as cost.
  for (const registered of [null, "2026-10-01"]) {
    txCalls.length = 0;
    stockCardWrites.length = 0;
    registeredFrom = registered;
    const result = await createPurchase(purchaseForm(
      [{ productId: "oil-1", unitName: "ลิตร", qty: 10, costPrice: 100, lotItems: [] }],
      { vatType: "EXCLUDING_VAT", vatRate: "7", shippingFee: "10", ...TAX_INVOICE },
    ));
    assert.equal(result.success, true, result.error ?? String(criticalErrors[0]));
    assert.deepEqual(stockCardWrites, [{ qtyIn: 10, priceIn: 100, landedCost: 80.7 }], String(registered));
    assert.deepEqual(createdItemLanded(), [80.7 / 10]);
    const data = (txCalls.find((call) => call.method === "purchase.create")?.args as { data: Row }).data;
    assert.deepEqual([data.subtotalAmount, data.vatAmount, data.netAmount], [1010, 70.7, 1080.7]);
  }
  // Two lines, shipping 10.70 − discount 5: VAT 283.90 + 5.70 = 289.60 split 8 : 1 by largest remainder.
  txCalls.length = 0;
  stockCardWrites.length = 0;
  registeredFrom = null;
  const twoLines = await createPurchase(purchaseForm(TWO_LINES, {
    shippingFee: "10.7", discount: "5", vatType: "EXCLUDING_VAT", vatRate: "7", ...TAX_INVOICE,
  }));
  assert.equal(twoLines.success, true, twoLines.error);
  assert.deepEqual(stockCardWrites, [
    { qtyIn: 24, priceIn: 150, landedCost: 257.42 },
    { qtyIn: 3, priceIn: 150, landedCost: 32.18 },
  ]);
});

test("V5: a VAT purchase without the tax invoice number or date is refused in Thai before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");
  const noNumber = await createPurchase(purchaseForm(TWO_LINES, { vatType: "EXCLUDING_VAT", vatRate: "7", taxInvoiceDate: "2026-09-30" }));
  assert.deepEqual(noNumber, { error: "ใบซื้อที่มี VAT ต้องระบุเลขที่ใบกำกับภาษี" });
  const noDate = await createPurchase(purchaseForm(TWO_LINES, { vatType: "INCLUDING_VAT", vatRate: "7", taxInvoiceNo: "IV-1" }));
  assert.deepEqual(noDate, { error: "ใบซื้อที่มี VAT ต้องระบุวันที่ใบกำกับภาษี" });
  const badDate = await createPurchase(purchaseForm(TWO_LINES, { vatType: "INCLUDING_VAT", vatRate: "7", taxInvoiceNo: "IV-1", taxInvoiceDate: "30/09/2026" }));
  assert.deepEqual(badDate, { error: "กรุณาระบุวันที่ใบกำกับภาษีให้ถูกต้อง" });
  assert.equal(txCalls.length, 0);
  // NO_VAT keeps both fields optional.
  assert.equal((await createPurchase(purchaseForm(TWO_LINES, {}))).success, true);
});

// ── updatePurchase: when a VAT change must rewrite the StockCard rows ────────

const SAVED_DATE = new Date("2026-09-29T17:00:00.000Z"); // 2026-09-30 in Thailand

const storedPurchase = (vatType: string, vatRate: number): Row => ({
  id: "po1", purchaseNo: "RR26093000001", status: "ACTIVE", supplierId: "sup-1", supplier: null,
  purchaseDate: SAVED_DATE, purchaseType: "CREDIT_PURCHASE", shippingFee: 0, discount: 0,
  vatType, vatRate, taxInvoiceNo: null, taxInvoiceDate: null,
  items: [{
    id: "item-1", lineNo: 1, productId: "oil-1", quantity: new Prisma.Decimal(10), costPrice: 107, landedCost: 0,
    showQty: new Prisma.Decimal(10), showUnitName: "ลิตร", moreDetail: null, lotItems: [],
    product: { code: "OIL-1", name: "น้ำมันเครื่อง" },
  }],
  purchaseReturns: [], supplierPaymentItems: [],
});

const LINE_10_X_107: Row[] = [{ productId: "oil-1", unitName: "ลิตร", qty: 10, costPrice: 107, lotItems: [] }];

const stockCardUpdates = (): Prisma.Sql[] =>
  txCalls
    .filter((call) => call.method === "$executeRaw" && (call.args as Prisma.Sql).sql.includes('UPDATE "StockCard"'))
    .map((call) => call.args as Prisma.Sql);

test("updatePurchase: NO_VAT → recoverable INCLUDING_VAT on an unchanged line rewrites the StockCard landed cost and replays MAVG", { skip: moduleMocksUnavailable }, async () => {
  registeredFrom = "2026-09-01";
  dbOverrides = { ...dbOverrides, purchase: { findUnique: async () => storedPurchase("NO_VAT", 0) } };
  const savedRow = {
    id: "sc-1", productId: "oil-1", docDate: SAVED_DATE, sorder: 1, referenceId: "item-1", source: "PURCHASE",
    qtyIn: 10, qtyOut: 0, priceIn: 107, landedCost: -70, usesReferenceCost: false,
  };
  txOverrides = { ...txOverrides, stockCard: { ...txOverrides.stockCard, findMany: async () => [savedRow] } };
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm(LINE_10_X_107, { vatType: "INCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }));

  assert.deepEqual(result, { success: true }, String(criticalErrors[0]));
  // 1,070.00 incl. 7 % → VAT 70.00, pre-VAT 1,000.00: the line's landed cost becomes −70.00.
  const [update] = stockCardUpdates();
  assert.ok(update, "the StockCard landed cost is rewritten in place");
  assert.ok(update.values.includes(-70), JSON.stringify(update.values));
  const productUpdate = txCalls.find((call) => call.method === "product.update");
  assert.equal(String((productUpdate?.args as { data: { avgCost: Prisma.Decimal } }).data.avgCost), "100", "MAVG 1,000 / 10");
  assert.ok(!txCalls.some((call) => call.method === "stockCard.createMany"), "the line itself is kept");
});

test("updatePurchase: NO_VAT → EXCLUDING_VAT (recoverable) without shipping/discount leaves stock untouched (as before V2)", { skip: moduleMocksUnavailable }, async () => {
  registeredFrom = "2026-09-01";
  dbOverrides = { ...dbOverrides, purchase: { findUnique: async () => storedPurchase("NO_VAT", 0) } };
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm(LINE_10_X_107, { vatType: "EXCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }));

  assert.deepEqual(result, { success: true }, String(criticalErrors[0]));
  assert.deepEqual(stockCardUpdates(), []);
  assert.ok(!txCalls.some((call) => call.method === "stockCard.createMany" || call.method === "stockCard.deleteMany"));
  assert.deepEqual(stockCardWrites, []);
});

test("updatePurchase: a tax invoice date that makes the VAT recoverable re-costs the kept line", { skip: moduleMocksUnavailable }, async () => {
  registeredFrom = "2026-09-15";
  dbOverrides = {
    ...dbOverrides,
    purchase: {
      findUnique: async () => ({ ...storedPurchase("INCLUDING_VAT", 7), taxInvoiceNo: "IV-1", taxInvoiceDate: parseDateOnlyToDate("2026-09-10") }),
    },
  };
  txOverrides = {
    ...txOverrides,
    stockCard: {
      ...txOverrides.stockCard,
      findMany: async () => [{
        id: "sc-1", productId: "oil-1", docDate: SAVED_DATE, sorder: 1, referenceId: "item-1", source: "PURCHASE",
        qtyIn: 10, qtyOut: 0, priceIn: 107, landedCost: -70, usesReferenceCost: false,
      }],
    },
  };
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm(LINE_10_X_107, {
    vatType: "INCLUDING_VAT", vatRate: "7", taxInvoiceNo: "IV-1", taxInvoiceDate: "2026-09-20",
  }));

  assert.deepEqual(result, { success: true }, String(criticalErrors[0]));
  const [update] = stockCardUpdates();
  assert.ok(update?.values.includes(-70), "the recoverable VAT leaves the stock cost");
});

test("updatePurchase: NO_VAT → non-recoverable EXCLUDING_VAT on an unchanged line adds the VAT to the StockCard landed cost", { skip: moduleMocksUnavailable }, async () => {
  registeredFrom = null;
  dbOverrides = { ...dbOverrides, purchase: { findUnique: async () => storedPurchase("NO_VAT", 0) } };
  txOverrides = {
    ...txOverrides,
    stockCard: {
      ...txOverrides.stockCard,
      findMany: async () => [{
        id: "sc-1", productId: "oil-1", docDate: SAVED_DATE, sorder: 1, referenceId: "item-1", source: "PURCHASE",
        qtyIn: 10, qtyOut: 0, priceIn: 107, landedCost: 74.9, usesReferenceCost: false,
      }],
    },
  };
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", purchaseForm(LINE_10_X_107, { vatType: "EXCLUDING_VAT", vatRate: "7", ...TAX_INVOICE }));

  assert.deepEqual(result, { success: true }, String(criticalErrors[0]));
  // 1,070.00 + 7 % = 1,144.90: the line's landed cost becomes +74.90 (VAT is cost while not registered).
  const [update] = stockCardUpdates();
  assert.ok(update?.values.includes(74.9), JSON.stringify(update?.values));
  const productUpdate = txCalls.find((call) => call.method === "product.update");
  assert.equal(String((productUpdate?.args as { data: { avgCost: Prisma.Decimal } }).data.avgCost), "114.49", "MAVG 1,144.90 / 10");
});
