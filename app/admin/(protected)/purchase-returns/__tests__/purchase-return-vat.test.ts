import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { getPurchaseReturnVatMismatchMessage, resolvePurchaseReturnTaxDocument } from "../purchase-return-vat";

// Owner decisions V3 / V5 for purchase returns: a return that references a purchase must use the
// purchase's VAT type and rate (server rejects a mismatch before any write, in Thai, without a
// critical alert) and inherits its recoverability; a VAT return names the supplier's credit note.

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
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") return async () => [];
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
                return { id: `${modelName}-id` };
              };
            },
          },
        );
      },
    },
  );

let txOverrides: ModelOverrides = {};
let dbOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const criticalReports: unknown[] = [];
type StockOut = { qtyOut: number; priceIn: number; usesReferenceCost?: boolean; source: string };
const stockWrites: StockOut[] = [];

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
    namedExports: { ...realAuth, requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }) },
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
        criticalReports.push(error);
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generatePurchaseReturnNo: async () => "PR26093000001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async (_tx: unknown, input: StockOut) => {
        stockWrites.push({ qtyOut: input.qtyOut, priceIn: input.priceIn, usesReferenceCost: input.usesReferenceCost, source: input.source });
        return "stock-card-out";
      },
    },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculatePurchaseReturnAmountRemain: async () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

const SOURCE_PURCHASE = {
  id: "purchase-1", status: "ACTIVE", supplierId: "sup-1", purchaseNo: "RR26090001",
  vatType: "INCLUDING_VAT", vatRate: 7, taxInvoiceDate: parseDateOnlyToDate("2026-09-01"),
};

beforeEach(() => {
  txCalls.length = 0;
  stockWrites.length = 0;
  criticalReports.length = 0;
  dbOverrides = {};
  txOverrides = {
    purchase: { findUnique: async () => SOURCE_PURCHASE },
    productUnit: { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] },
    product: {
      findMany: async () => [{ id: "prod-1", avgCost: 100, costPrice: 100, inventoryTracking: "NON_TRACKED", isLotControl: false }],
    },
    purchaseReturn: { create: async () => ({ id: "pr-new" }) },
  };
});

const returnForm = (overrides: Record<string, string> = {}): FormData => {
  const form = new FormData();
  const fields: Record<string, string> = {
    returnDate: "2026-09-30",
    supplierId: "sup-1",
    purchaseId: "purchase-1",
    type: "DISCOUNT",
    settlementType: "SUPPLIER_CREDIT",
    vatType: "INCLUDING_VAT",
    vatRate: "7",
    taxInvoiceNo: "CN-S-0001",
    taxInvoiceDate: "2026-09-30",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 1, costPrice: 107, lotItems: [] }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const writes = (): string[] =>
  txCalls.map((call) => call.method).filter((method) => /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(method));

test("mismatch message: same VAT passes, a NO_VAT purchase ignores the rate, anything else names the purchase VAT", () => {
  const purchase = { purchaseNo: "RR26090001", vatType: "INCLUDING_VAT" as const, vatRate: 7 };
  assert.equal(getPurchaseReturnVatMismatchMessage(purchase, { vatType: "INCLUDING_VAT", vatRate: 7 }), null);
  assert.equal(
    getPurchaseReturnVatMismatchMessage({ purchaseNo: "RR1", vatType: "NO_VAT", vatRate: 7 }, { vatType: "NO_VAT", vatRate: 0 }),
    null,
  );
  assert.equal(
    getPurchaseReturnVatMismatchMessage(purchase, { vatType: "NO_VAT", vatRate: 0 }),
    "ภาษีของใบคืนสินค้าต้องตรงกับใบซื้ออ้างอิง RR26090001 (ราคารวม VAT 7%)",
  );
  assert.ok(getPurchaseReturnVatMismatchMessage(purchase, { vatType: "INCLUDING_VAT", vatRate: 10 }));
});

test("recoverability document: the referenced purchase when there is one, else the return itself", () => {
  const own = { vatType: "EXCLUDING_VAT", vatRate: 7, taxInvoiceDate: parseDateOnlyToDate("2026-09-30") };
  const source = { vatType: "EXCLUDING_VAT", vatRate: 7, taxInvoiceDate: parseDateOnlyToDate("2026-08-01") };
  assert.equal(resolvePurchaseReturnTaxDocument(own, source), source);
  assert.equal(resolvePurchaseReturnTaxDocument(own, null), own);
});

test("createPurchaseReturn: a VAT different from the referenced purchase is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  const result = await createPurchaseReturn(returnForm({ vatType: "NO_VAT", vatRate: "0" }));
  assert.deepEqual(result, { error: "ภาษีของใบคืนสินค้าต้องตรงกับใบซื้ออ้างอิง RR26090001 (ราคารวม VAT 7%)" });
  assert.deepEqual(writes(), []);
  assert.equal(criticalReports.length, 0);
});

test("createPurchaseReturn: a VAT return needs the supplier credit-note number and date (Thai)", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  assert.deepEqual(
    await createPurchaseReturn(returnForm({ taxInvoiceNo: "" })),
    { error: "ใบคืนสินค้าที่มี VAT ต้องระบุเลขที่ใบลดหนี้ของ supplier" },
  );
  assert.deepEqual(
    await createPurchaseReturn(returnForm({ taxInvoiceDate: "" })),
    { error: "ใบคืนสินค้าที่มี VAT ต้องระบุวันที่ใบลดหนี้" },
  );
  assert.equal(txCalls.length, 0);
});

test("createPurchaseReturn: the purchase's VAT and the credit note are saved", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  const result = await createPurchaseReturn(returnForm());
  assert.equal(result.success, true, result.error ?? String(criticalReports[0]));
  const created = txCalls.find((call) => call.method === "purchaseReturn.create");
  const data = (created?.args as { data: Record<string, unknown> }).data;
  assert.equal(data.vatType, "INCLUDING_VAT");
  assert.equal(data.taxInvoiceNo, "CN-S-0001");
  assert.deepEqual(data.taxInvoiceDate, parseDateOnlyToDate("2026-09-30"));
});

test("getPurchaseDetail hands the form the purchase VAT basis as plain values", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides = { purchase: { findUnique: async () => ({ ...SOURCE_PURCHASE, items: [] }) } };
  const { getPurchaseDetail } = await import("../actions");
  const detail = await getPurchaseDetail("purchase-1");
  assert.deepEqual(detail?.vat, { vatType: "INCLUDING_VAT", vatRate: 7, taxInvoiceDate: "2026-09-01" });
});

test("V3: a RETURN against a non-recoverable EXCLUDING_VAT purchase goes out at the VAT-inclusive reference cost", { skip: moduleMocksUnavailable }, async () => {
  // The purchase: 10 × 100 excl. 7 % + shipping 10, not registered → StockCard priceIn 100, landed +80.70
  // (V1 option ข: the VAT is cost), i.e. 108.07 per unit.
  txOverrides = {
    ...txOverrides,
    purchase: {
      findUnique: async () => ({ ...SOURCE_PURCHASE, vatType: "EXCLUDING_VAT", items: [{ id: "pi-1", productId: "prod-1" }] }),
    },
    product: {
      findMany: async () => [{ id: "prod-1", avgCost: 95, costPrice: 100, inventoryTracking: "TRACKED", isLotControl: false }],
    },
    stockCard: { findMany: async () => [{ productId: "prod-1", qtyIn: 10, priceIn: 100, landedCost: 80.7 }] },
  };
  const { createPurchaseReturn } = await import("../actions");

  const result = await createPurchaseReturn(returnForm({
    type: "RETURN",
    vatType: "EXCLUDING_VAT",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 1, costPrice: 100, lotItems: [] }]),
  }));

  assert.equal(result.success, true, result.error ?? String(criticalReports[0]));
  assert.equal(stockWrites.length, 1);
  assert.equal(stockWrites[0].source, "RETURN_OUT");
  assert.equal(stockWrites[0].qtyOut, 1);
  assert.equal(stockWrites[0].usesReferenceCost, true, "the purchase's own StockCard cost, not the running average");
  assert.ok(Math.abs(stockWrites[0].priceIn - 108.07) < 1e-9, String(stockWrites[0].priceIn));
});
