import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { STOCK_EDIT_BOUNDARY_REASON } from "@/lib/document-mutation-guard";
import { SALE_REVENUE_ALLOCATION_USER_MESSAGE, SaleRevenueAllocationError } from "@/lib/sale-profit-revenue";

// R2 phase 1: a sale whose stock row comes before an ACTIVE supplier DN on the same SKU.
// A header-only edit (same lines, same date) rewrites no StockCard row and must save;
// a line change deletes that row and must stop with the shared DN message before any write.
//
// R12 (E5): the header is Σ stored (2-decimal) line totals, and an allocator error that
// still escapes becomes a Thai user message without a critical alert.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Where = { where?: Record<string, unknown>; distinct?: unknown };

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

const SALE_NO = "SA2609200001";
const SALE_UPDATED_AT = new Date("2026-09-20T03:00:00.000Z");
const saleRow = { productId: "prod-1", docNo: SALE_NO, docDate: new Date("2026-09-19T17:00:00.000Z"), sorder: 1, valuationEpoch: 0 };
const debitRow = { productId: "prod-1", docNo: "SDN26090001", docDate: new Date("2026-09-28T17:00:00.000Z"), sorder: 5, valuationEpoch: 1 };
const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];
let criticalReports = 0;
let rebuildError: Error | null = null;

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
    namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, replaceDocumentPayments: async () => undefined },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculateSaleAmountRemain: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: { ...realWhtReceived, persistWhtReceived: async () => undefined },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      ...realProfitFact,
      rebuildSaleProfitFacts: async () => {
        if (rebuildError) throw rebuildError;
      },
    },
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

const existingSale = () => ({
  id: "sale1",
  saleNo: SALE_NO,
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
  items: [{
    id: "item-1", productId: "prod-1", quantity: 1, salePrice: 100, unitListPrice: 100, warrantyDays: 0,
    supplierId: null, supplierName: null, moreDetail: null, showQty: 1, showUnitName: "ชิ้น",
    product: { name: "ไส้กรอง" }, lotItems: [],
  }],
  creditNotes: [],
  receipts: [],
});

/** StockCard: the sale's own row, and a later value-only DN row on the same SKU. */
const stockCardWithLaterDebit = {
  findMany: async (args: unknown) => {
    const { where = {}, distinct } = args as Where;
    if (distinct) return [{ productId: "prod-1" }];
    if (JSON.stringify(where.source ?? null).includes("SUPPLIER_DEBIT")) return [debitRow];
    return where.docNo === SALE_NO ? [saleRow] : [];
  },
};
const activeDebit = {
  findMany: async (args: unknown) => ((args as Where).where?.status === "ACTIVE" ? [{ id: "dn-1", debitNo: debitRow.docNo }] : []),
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  criticalReports = 0;
  rebuildError = null;
  const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] };
  dbOverrides = {
    sale: { findUnique: async () => existingSale(), findMany: async () => [{ saleNo: SALE_NO }] },
    productUnit: units,
    product: { findMany: async () => [] },
    stockCard: stockCardWithLaterDebit,
    supplierDebitNote: activeDebit,
  };
  txOverrides = {
    sale: {
      findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }),
      findMany: async () => [{ saleNo: SALE_NO }],
    },
    productUnit: units,
    product: {
      findMany: async () => [{
        id: "prod-1", avgCost: 50, costPrice: 50, salePrice: 100, retailPrice: 100, memberPrice: 100,
        inventoryTracking: "TRACKED", isLotControl: false,
      }],
    },
    stockCard: stockCardWithLaterDebit,
    supplierDebitNote: activeDebit,
  };
});

const saleForm = (line: Record<string, unknown>, fields: Record<string, string> = {}): FormData => {
  const formData = new FormData();
  const values: Record<string, string> = {
    saleDate: "2026-09-20",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    note: "แก้ไขเฉพาะหมายเหตุ",
    items: JSON.stringify([{
      productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 100, unitListPrice: 100,
      lineDiscount: 0, warrantyDays: 0, lotItems: [], ...line,
    }]),
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
};

test("a header-only sale edit saves although its stock row is before an active DN", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({}));

  assert.deepEqual(result, { success: true });
  assert.ok(txCalls.some((call) => call.method === "sale.update"), "the header is written");
  assert.ok(!txCalls.some((call) => call.method === "stockCard.deleteMany"), "no stock row is deleted");
  assert.equal(criticalReports, 0);
});

test("a line change on the SKU with a later active DN is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({ qty: 2 }));

  assert.ok(result.error?.includes(STOCK_EDIT_BOUNDARY_REASON), result.error);
  assert.ok(result.error?.includes("SDN26090001"));
  const checked = txCalls.find(
    (call) => call.method === "stockCard.findMany" && (call.args as Where).where?.referenceId !== undefined,
  );
  assert.deepEqual((checked?.args as Where).where, { docNo: SALE_NO, referenceId: { in: ["item-1"] } });
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)).map((call) => call.method), []);
  assert.equal(criticalReports, 0, "a DN block is a user message, not a critical alert");
});

test("a sale date change rewrites every row and is refused too", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({}, { saleDate: "2026-09-21" }));

  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)).map((call) => call.method), []);
});

test("an allocator error on save returns the Thai message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  rebuildError = new SaleRevenueAllocationError("Sale revenue has no allocation basis");
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm({}));

  assert.deepEqual(result, { error: SALE_REVENUE_ALLOCATION_USER_MESSAGE });
  assert.equal(criticalReports, 0);
});

test("E5: two lines of 1 × 0.004 save a 0.00 header equal to the stored 0.00 lines", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.supplierDebitNote = { findMany: async () => [] };
  dbOverrides.supplierDebitNote = { findMany: async () => [] };
  const { updateSale } = await import("../actions");
  const formData = saleForm({});
  const tinyLine = {
    productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 0.004, unitListPrice: 0.004,
    lineDiscount: 0, warrantyDays: 0, lotItems: [],
  };
  formData.set("items", JSON.stringify([tinyLine, tinyLine]));

  const result = await updateSale("sale1", formData);

  assert.deepEqual(result, { success: true });
  const header = txCalls.find((call) => call.method === "sale.update")?.args as { data: Record<string, unknown> };
  assert.equal(header.data.totalAmount, 0);
  assert.equal(header.data.subtotalAmount, 0);
  assert.equal(header.data.netAmount, 0);
  const lineTotals = txCalls
    .filter((call) => call.method === "saleItem.create")
    .map((call) => (call.args as { data: { totalAmount: number } }).data.totalAmount);
  assert.deepEqual(lineTotals, [0, 0]);
});
