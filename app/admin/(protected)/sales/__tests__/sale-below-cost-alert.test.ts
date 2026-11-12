import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { findSaleLineBelowCost } from "@/lib/sale-below-cost";

// M10 (review 2026-11-12): after a sale is saved, a line priced below its cost sends ONE
// notification (bell + Telegram through createNotification) for the whole sale, from after(),
// so it never blocks or slows the save. A line at or above cost sends nothing, and a failing
// alert never breaks the save. Kept lines of an edit are not re-reported.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type NotificationRow = { type: string; severity: string; title: string; body: string; link: string; entityId: string };

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
const telegramSends: Array<{ type: string; title: string }> = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  // createNotification logs each Telegram delivery; keep the test output readable.
  mock.method(console, "info", () => undefined);
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, dbCalls),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realTelegram = await import("@/lib/telegram");
  await mock.module("@/lib/telegram", {
    namedExports: {
      ...realTelegram,
      sendTelegramNotification: async (payload: { type: string; title: string }) => {
        telegramSends.push({ type: payload.type, title: payload.title });
        return { sentCount: 1 };
      },
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
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SA2609200001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCard: async () => undefined, writeStockCard: async () => "stock-card-id" },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, clearCashBankSourceMovements: async () => undefined, replaceCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, clearDocumentPayments: async () => undefined, replaceDocumentPayments: async () => undefined },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculateSaleAmountRemain: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: { ...realWhtReceived, cancelWhtReceivedForDocument: async () => undefined, persistWhtReceived: async () => undefined },
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
  id: "item-1", productId: "prod-1", quantity: 1, salePrice: 580, unitListPrice: 580, warrantyDays: 0,
  supplierId: null, supplierName: null, moreDetail: null, showQty: 1, showUnitName: "ชิ้น",
  product: { name: "ผ้าเบรกหน้า" }, lotItems: [] as Array<{ lotNo: string; qty: number }>,
};

const existingSale = {
  id: "sale1", saleNo: "SA2609200001", status: "ACTIVE", channel: "STORE",
  saleDate: new Date("2026-09-19T17:00:00.000Z"), customerId: "cust-1", quotationId: null, quotationRevision: null,
  updatedAt: SALE_UPDATED_AT, vatType: "NO_VAT", vatRate: 0, signerName: "Tester", signerSignatureUrl: null,
  signedAt: null, user: { name: "Tester", signatureUrl: null }, items: [storedItem], creditNotes: [], receipts: [],
};

const line = (overrides: Record<string, unknown> = {}) => ({
  productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 580, unitListPrice: 580, lineDiscount: 0,
  warrantyDays: 0, lotItems: [], ...overrides,
});

const saleForm = (items: unknown[], overrides: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-20", customerId: "cust-1", paymentType: "CREDIT_SALE", fulfillmentType: "PICKUP",
    vatType: "NO_VAT", vatRate: "0", items: JSON.stringify(items), ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const notificationRows = (): NotificationRow[][] =>
  dbCalls
    .filter((call) => call.method === "notification.createMany")
    .map((call) => (call.args as { data: NotificationRow[] }).data);

const runAfterCallbacks = async (): Promise<void> => {
  for (const callback of afterCallbacks.splice(0)) await callback();
};

const product = (id: string, avgCost: number) => ({
  id, avgCost, costPrice: avgCost, salePrice: 900, retailPrice: 900, memberPrice: 900,
  inventoryTracking: "TRACKED", isLotControl: false,
});

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  afterCallbacks.length = 0;
  telegramSends.length = 0;
  const units = {
    findMany: async () => [
      { productId: "prod-1", name: "ชิ้น", scale: 1 },
      { productId: "prod-1", name: "กล่อง", scale: 10 },
      { productId: "prod-2", name: "ชิ้น", scale: 1 },
    ],
  };
  dbOverrides = {
    sale: { findUnique: async () => existingSale },
    productUnit: units,
    user: { findMany: async () => [{ id: "admin-1" }] },
    notification: { createMany: async (args: unknown) => ({ count: (args as { data: unknown[] }).data.length }) },
    product: {
      // Stock before the save (out-of-stock alert) reads with a stock filter; the alert reads names.
      findMany: async (args: unknown) => {
        const where = (args as { where: { stock?: unknown } }).where;
        if (where.stock) return [];
        return [{ id: "prod-1", code: "BP-01", name: "ผ้าเบรกหน้า" }, { id: "prod-2", code: "OF-02", name: "ไส้กรองน้ำมัน" }];
      },
    },
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: units,
    product: { findMany: async () => [product("prod-1", 850), product("prod-2", 120)] },
  };
});

test("a sale with a line below cost sends one bell + Telegram alert after the response", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm([line(), line({ productId: "prod-2", qty: 2, salePrice: 150, unitListPrice: 150 })]));

  assert.deepEqual(result, { success: true, saleId: "sale-id", saleNo: "SA2609200001" });
  assert.deepEqual(notificationRows(), [], "nothing is sent before the response");
  await runAfterCallbacks();
  const rows = notificationRows();
  assert.equal(rows.length, 1, "createNotification ran once");
  assert.equal(rows[0].length, 1, "one row for the one active admin");
  assert.equal(rows[0][0].type, "SALE_BELOW_COST");
  assert.equal(rows[0][0].severity, "WARNING");
  assert.equal(rows[0][0].title, "ขายต่ำกว่าทุน SA2609200001 (1 รายการ)");
  assert.equal(rows[0][0].body, "• [BP-01] ผ้าเบรกหน้า 1 ชิ้น — ราคาขาย 580.00 ทุน 850.00 บาท/ชิ้น");
  assert.equal(rows[0][0].link, "/admin/sales/sale-id");
  assert.equal(rows[0][0].entityId, "sale-id");
  assert.deepEqual(telegramSends, [{ type: "SALE_BELOW_COST", title: "ขายต่ำกว่าทุน SA2609200001 (1 รายการ)" }]);
});

test("several lines below cost still make a single alert for the sale", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  await createSale(saleForm([line(), line({ productId: "prod-2", salePrice: 100, unitListPrice: 100 })]));
  await runAfterCallbacks();

  const rows = notificationRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].body.split("\n").length, 2);
  assert.match(rows[0][0].body, /\[OF-02\] ไส้กรองน้ำมัน 1 ชิ้น — ราคาขาย 100\.00 ทุน 120\.00 บาท\/ชิ้น/);
});

test("lines at or above cost send nothing", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm([
    line({ salePrice: 850, unitListPrice: 850 }),
    // 1 box = 10 pieces at 8,500 = 850 per piece: exactly cost.
    line({ unitName: "กล่อง", salePrice: 8500, unitListPrice: 9000 }),
  ]));

  assert.equal(result.success, true);
  await runAfterCallbacks();
  assert.deepEqual(notificationRows(), []);
  assert.deepEqual(telegramSends, []);
});

test("a failing alert never breaks the save", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.notification = {
    createMany: async () => {
      throw new Error("connection reset");
    },
  };
  const { createSale } = await import("../actions");

  const spy = mock.method(console, "error", () => undefined);
  try {
    const result = await createSale(saleForm([line()]));
    assert.deepEqual(result, { success: true, saleId: "sale-id", saleNo: "SA2609200001" });
    await runAfterCallbacks();
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(telegramSends, []);
});

test("an edit reports a re-priced line but not a kept one", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  // The stored line (580, below cost) is kept as it is: no alert.
  assert.deepEqual(await updateSale("sale1", saleForm([line()], { note: "แก้หมายเหตุ" })), { success: true });
  await runAfterCallbacks();
  assert.deepEqual(notificationRows(), []);

  // The line is re-priced, still below cost: one alert naming the sale.
  assert.deepEqual(await updateSale("sale1", saleForm([line({ salePrice: 600, unitListPrice: 600 })])), { success: true });
  await runAfterCallbacks();
  const rows = notificationRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0].title, "ขายต่ำกว่าทุน SA2609200001 (1 รายการ)");
  assert.equal(rows[0][0].link, "/admin/sales/sale1");
});

test("the comparison: net price after line discount, pre-VAT, per base unit", () => {
  const base = { productId: "p", unitName: "ชิ้น", qty: 1, unitScale: 1, costPerBase: 100, vatType: "NO_VAT" as const, vatRate: 0 };
  // salePrice is the net price after the line discount (list 120 − 25 discount = 95).
  assert.deepEqual(findSaleLineBelowCost({ ...base, salePrice: 95 }),
    { productId: "p", unitName: "ชิ้น", qty: 1, pricePerUnit: 95, costPerUnit: 100 });
  assert.equal(findSaleLineBelowCost({ ...base, salePrice: 100 }), null, "equal to cost is not below");
  assert.equal(findSaleLineBelowCost({ ...base, salePrice: 99.996 }), null, "under half a satang is rounding");
  // A VAT-included price is compared without its VAT: 107 incl. 7% = 100 pre-VAT.
  assert.equal(findSaleLineBelowCost({ ...base, salePrice: 107, vatType: "INCLUDING_VAT", vatRate: 7 }), null);
  assert.equal(findSaleLineBelowCost({ ...base, salePrice: 106, vatType: "INCLUDING_VAT", vatRate: 7 })?.costPerUnit, 100);
  // A VAT-excluded price is already pre-VAT.
  assert.equal(findSaleLineBelowCost({ ...base, salePrice: 100, vatType: "EXCLUDING_VAT", vatRate: 7 }), null);
  // Unit scale: 1 box of 12 at 1,150 = 95.83 per piece against cost 100 per piece.
  assert.deepEqual(findSaleLineBelowCost({ ...base, unitName: "โหล", unitScale: 12, salePrice: 1150 }),
    { productId: "p", unitName: "โหล", qty: 1, pricePerUnit: 1150, costPerUnit: 1200 });
  assert.equal(findSaleLineBelowCost({ ...base, unitScale: 12, salePrice: 1200 }), null);
  // No cost recorded: never reported.
  assert.equal(findSaleLineBelowCost({ ...base, costPerBase: 0, salePrice: 0 }), null);
});
