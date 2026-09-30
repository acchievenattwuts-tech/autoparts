import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// R1 (purchase side): SupplierDebitNoteItem.purchaseItemId is nullable with ON DELETE SET
// NULL. A purchase edit that deletes a PurchaseItem referenced only by a CANCELLED DN line
// now saves (the database clears the link) instead of failing with P2003 + a critical
// alert. An ACTIVE DN on the purchase still blocks the edit before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type Where = { where?: Record<string, unknown> };

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

const PURCHASE_NO = "RRC260920001";
const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;
const purchaseRow = (docDate: Date) => ({ docNo: PURCHASE_NO, docDate, sorder: 1, valuationEpoch: 0 });
const debitRow = { productId: "prod-2", docNo: "SDN26090001", docDate: new Date("2026-09-28T17:00:00.000Z"), sorder: 5, valuationEpoch: 1 };

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
let criticalReports: unknown[] = [];
/** The DN "table": its status decides whether the purchase is still referenced. */
let debitStatus: "ACTIVE" | "CANCELLED" = "CANCELLED";

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
      safeWriteAuditLog: async () => undefined,
    },
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
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCardMany: async () => undefined },
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

const purchaseItem = (id: string, productId: string, lineNo: number) => ({
  id, lineNo, productId, supplierId: "sup-1", quantity: 2, costPrice: 50, landedCost: 0,
  totalAmount: 100, subtotalAmount: 100, moreDetail: null, lotItems: [],
  product: { code: productId, name: productId },
});

const existingPurchase = () => ({
  id: "po1",
  purchaseNo: PURCHASE_NO,
  status: "ACTIVE",
  supplierId: "sup-1",
  supplier: null,
  purchaseDate: new Date("2026-09-19T17:00:00.000Z"), // 2026-09-20 in Thailand
  purchaseType: "CREDIT_PURCHASE",
  shippingFee: 0,
  discount: 0,
  items: [purchaseItem("item-1", "prod-1", 1), purchaseItem("item-2", "prod-2", 2)],
  purchaseReturns: [],
  supplierPaymentItems: [],
});

/** Mirrors the guard's filter: only an ACTIVE DN still references the purchase. */
const debitNotes = {
  findMany: async (args: unknown) => {
    const where = (args as Where).where ?? {};
    return where.status === "ACTIVE" && debitStatus !== "ACTIVE" ? [] : [{ id: "dn-1", debitNo: "SDN26090001" }];
  },
};

beforeEach(() => {
  txCalls.length = 0;
  criticalReports = [];
  debitStatus = "CANCELLED";
  const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] };
  dbOverrides = {
    purchase: { findUnique: async () => existingPurchase() },
    productUnit: units,
    supplierDebitNote: debitNotes,
  };
  txOverrides = {
    productUnit: units,
    product: {
      findMany: async () => [{ id: "prod-1", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false }],
    },
    stockCard: {
      findMany: async (args: unknown) => {
        const where = (args as Where).where ?? {};
        if (where.source === "SUPPLIER_DEBIT") return [debitRow];
        return where.docNo === PURCHASE_NO ? [{ productId: "prod-2", ...purchaseRow(new Date("2026-09-19T17:00:00.000Z")) }] : [];
      },
    },
    supplierDebitNote: debitNotes,
  };
});

/** Keeps line 1 unchanged and drops line 2 (the one the cancelled DN pointed at). */
const dropSecondLineForm = (): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-09-20",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 2, costPrice: 50, lotItems: [] }]),
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

test("deleting a PurchaseItem referenced only by a cancelled DN line saves without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", dropSecondLineForm());

  assert.deepEqual(result, { success: true });
  const deleted = txCalls.filter((call) => call.method === "purchaseItem.delete").map((call) => call.args);
  assert.deepEqual(deleted, [{ where: { id: "item-2" } }], "the removed line is deleted; the DB clears the cancelled DN link");
  assert.deepEqual(criticalReports, []);
});

test("an ACTIVE DN that appears after the pre-check still blocks the edit inside the transaction", { skip: moduleMocksUnavailable }, async () => {
  // Pre-check (db) sees no active DN; the locked re-check (tx) does.
  dbOverrides.supplierDebitNote = { findMany: async () => [] };
  debitStatus = "ACTIVE";
  const { updatePurchase } = await import("../actions");

  const result = await updatePurchase("po1", dropSecondLineForm());

  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)).map((call) => call.method), []);
  assert.deepEqual(criticalReports, []);
});

test("an ACTIVE DN on the purchase blocks even a header-only edit at the pre-check", { skip: moduleMocksUnavailable }, async () => {
  debitStatus = "ACTIVE";
  const { updatePurchase } = await import("../actions");
  const formData = dropSecondLineForm();
  formData.set("items", JSON.stringify([
    { productId: "prod-1", unitName: "ชิ้น", qty: 2, costPrice: 50, lotItems: [] },
    { productId: "prod-2", unitName: "ชิ้น", qty: 2, costPrice: 50, lotItems: [] },
  ]));
  formData.set("note", "แก้ไขเฉพาะหมายเหตุ");

  const result = await updatePurchase("po1", formData);

  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.equal(txCalls.length, 0, "no transaction work at all");
});
