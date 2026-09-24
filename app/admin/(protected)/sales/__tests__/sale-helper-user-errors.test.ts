import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// createSale / updateSale: user-fixable conditions raised by the shared helpers the
// sale transaction runs (lib/cash-bank, lib/wht-received, lib/sale-core) and the
// createSale product/unit lookups and overlapping price promotions return their Thai
// message — not the generic error — and raise no critical alert, while unexpected
// errors are still reported. The helpers run for real against a fake tx.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

const makeClient = (overrides: () => ModelOverrides, calls: string[]) =>
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
              return async (...args: unknown[]) => {
                calls.push(`${modelName}.${method}`);
                if (override) return override(...args);
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

const GENERIC_ERROR = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
const SALE_UPDATED_AT = new Date("2026-09-20T03:00:00.000Z");

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: string[] = [];
const criticalReports: unknown[] = [];
const criticalContexts: unknown[] = [];

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
      writeAuditLogTx: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown, context: unknown) => {
        criticalReports.push(error);
        criticalContexts.push(context);
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateSaleNo: async () => "SA202609240001" },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCard: async () => undefined },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
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

const cashAccount = (overrides: Record<string, unknown> = {}) => ({
  id: "acc-1",
  type: "CASH",
  code: "CASH-1",
  name: "เงินสด",
  isActive: true,
  openingDate: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const linePayload = {
  productId: "prod-1",
  unitName: "ชิ้น",
  qty: 2,
  salePrice: 100,
  unitListPrice: 100,
  lineDiscount: 0,
  warrantyDays: 0,
  lotItems: [],
};

const WHT = { incomeTypeId: "it-1", baseAmount: 200, rate: 3, taxAmount: 6 };

const saleForm = (overrides: Record<string, string> = {}, cashAmount = 200): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-20",
    customerId: "cust-1",
    paymentType: "CASH_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify([linePayload]),
    payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: cashAmount }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const existingSale = {
  id: "sale1",
  saleNo: "SA2609200001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-09-19T17:00:00.000Z"), // 2026-09-20 in Thailand
  customerId: "cust-1",
  cashBankAccountId: "acc-1",
  quotationId: null,
  quotationRevision: null,
  updatedAt: SALE_UPDATED_AT,
  vatType: "NO_VAT",
  vatRate: 0,
  signerName: "Tester",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Tester", signatureUrl: null },
  items: [
    {
      id: "item-1",
      productId: "prod-1",
      quantity: 2,
      salePrice: 100,
      unitListPrice: 100,
      warrantyDays: 0,
      supplierId: null,
      supplierName: null,
      moreDetail: null,
      showQty: 2,
      showUnitName: "ชิ้น",
      product: { name: "ไส้กรอง" },
      lotItems: [],
    },
  ],
  creditNotes: [],
  receipts: [],
};

const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] };
const products = {
  findMany: async () => [
    {
      id: "prod-1",
      avgCost: 50,
      costPrice: 50,
      salePrice: 100,
      retailPrice: 100,
      memberPrice: 100,
      inventoryTracking: "NON_TRACKED",
      isLotControl: false,
    },
  ],
};

beforeEach(() => {
  txCalls.length = 0;
  criticalReports.length = 0;
  criticalContexts.length = 0;
  dbOverrides = {
    sale: { findUnique: async () => existingSale },
    productUnit: units,
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: units,
    product: products,
    cashBankAccount: { findMany: async () => [cashAccount()] },
  };
});

const withConsoleErrorSpy = async <T>(run: () => Promise<T>): Promise<{ result: T; consoleErrors: number }> => {
  let consoleErrors = 0;
  const spy = mock.method(console, "error", () => {
    consoleErrors += 1;
  });
  try {
    return { result: await run(), consoleErrors };
  } finally {
    spy.mock.restore();
  }
};

// ── createSale ──────────────────────────────────────────────────────────────

test("createSale returns the cash/bank posting message for a closed receiving account", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = { findMany: async () => [cashAccount({ isActive: false })] };
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm());

  assert.deepEqual(result, { error: "บัญชีเงินสด/ธนาคาร CASH-1 - เงินสด ถูกปิดใช้งานแล้ว" });
  assert.deepEqual(criticalReports, []);
  assert.equal(txCalls.includes("cashBankMovement.createMany"), false);
});

test("createSale returns the receiving-account message when the account is gone", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = { findMany: async () => [] };
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm());

  assert.deepEqual(result, { error: "ไม่พบบัญชีรับเงิน" });
  assert.deepEqual(criticalReports, []);
  assert.equal(txCalls.includes("sale.create"), false);
});

test("createSale returns the withholding-tax income-type message", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.whtIncomeType = { findUnique: async () => ({ id: "it-1", label: "ค่าบริการ", isActive: true, usableForReceived: false }) };
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm({ wht: JSON.stringify(WHT) }, 194));

  assert.deepEqual(result, { error: "ประเภทเงินได้ที่เลือกใช้กับภาษีที่ถูกหักไม่ได้" });
  assert.deepEqual(criticalReports, []);
  assert.equal(txCalls.includes("whtReceived.create"), false);
});

test("createSale returns the product / unit not-found messages", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");

  txOverrides.product = { findMany: async () => [] };
  assert.deepEqual(await createSale(saleForm()), { error: "ไม่พบสินค้า" });

  txOverrides.product = products;
  txOverrides.productUnit = { findMany: async () => [] };
  assert.deepEqual(await createSale(saleForm()), { error: "ไม่พบหน่วยนับ ชิ้น ของสินค้า" });

  assert.deepEqual(criticalReports, []);
  assert.equal(txCalls.includes("saleItem.create"), false);
});

test("createSale still hides unexpected errors behind the generic message and reports them", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = {
    findMany: async () => {
      throw new Error("connection reset");
    },
  };
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm());

  assert.deepEqual(result, { error: GENERIC_ERROR });
  assert.equal((criticalReports[0] as Error | undefined)?.message, "connection reset");
});

test("createSale names the products with overlapping published price promotions", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.customer = {
    findUnique: async () => ({
      customerType: { isActive: true, priceList: { id: "pl-1", code: "RETAIL", isActive: true } },
    }),
  };
  const promotionRow = (promotionId: string) => ({
    productId: "prod-1",
    promotionId,
    promotionPrice: 90,
    product: { code: "P0001", name: "ไส้กรอง" },
  });
  txOverrides.pricePromotionItem = {
    findMany: async () => [promotionRow("promo-1"), promotionRow("promo-2")],
  };
  const { createSale } = await import("../actions");

  const result = await createSale(saleForm());

  assert.deepEqual(result, {
    error: "มีโปรโมชั่นราคาที่เผยแพร่ซ้อนกันสำหรับสินค้า P0001 ไส้กรอง กรุณาตรวจสอบหน้าโปรโมชั่นราคา",
  });
  assert.deepEqual(criticalReports, []);
  assert.equal(txCalls.includes("sale.create"), false);
});

// ── updateSale ──────────────────────────────────────────────────────────────

test("updateSale returns the cash/bank posting message for a date before the opening balance", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = {
    findMany: async () => [cashAccount({ openingDate: new Date("2026-10-01T00:00:00.000Z") })],
  };
  const { updateSale } = await import("../actions");

  const { result, consoleErrors } = await withConsoleErrorSpy(() => updateSale("sale1", saleForm()));

  assert.deepEqual(result, { error: "วันที่รายการของบัญชี CASH-1 - เงินสด ต้องไม่ก่อนวันที่ยอดยกมา" });
  assert.equal(consoleErrors, 0);
  assert.deepEqual(criticalReports, []);
});

test("updateSale returns the receiving-account message when the account is gone", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = { findMany: async () => [] };
  const { updateSale } = await import("../actions");

  const { result, consoleErrors } = await withConsoleErrorSpy(() => updateSale("sale1", saleForm()));

  assert.deepEqual(result, { error: "ไม่พบบัญชีรับเงิน" });
  assert.equal(consoleErrors, 0);
  assert.equal(txCalls.includes("sale.update"), false);
});

test("updateSale returns the 50 ทวิ attachment message when withholding tax is removed", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.whtReceived = { findFirst: async () => ({ id: "wht-1", _count: { attachments: 1 } }) };
  const { updateSale } = await import("../actions");

  const { result, consoleErrors } = await withConsoleErrorSpy(() => updateSale("sale1", saleForm()));

  assert.deepEqual(result, {
    error: "เอกสารนี้มีไฟล์แนบหนังสือรับรอง 50 ทวิ อยู่ กรุณาลบไฟล์แนบก่อนจึงจะเอายอดภาษีหัก ณ ที่จ่ายออกได้",
  });
  assert.equal(consoleErrors, 0);
  assert.equal(txCalls.includes("whtReceived.delete"), false);
});

test("updateSale returns the withholding-tax income-type message", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  // whtIncomeType.findUnique returns null by default: the type no longer exists.
  const { result, consoleErrors } = await withConsoleErrorSpy(() =>
    updateSale("sale1", saleForm({ wht: JSON.stringify(WHT) }, 194)),
  );

  assert.deepEqual(result, { error: "ประเภทเงินได้ที่เลือกใช้กับภาษีที่ถูกหักไม่ได้" });
  assert.equal(consoleErrors, 0);
});

test("updateSale reports unexpected errors as critical, with the sale and user ids", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = {
    findMany: async () => {
      throw new Error("connection reset");
    },
  };
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm());

  assert.deepEqual(result, { error: GENERIC_ERROR });
  assert.equal((criticalReports[0] as Error | undefined)?.message, "connection reset");
  assert.deepEqual(criticalContexts, [{ scope: "sales.update", entityId: "sale1", userId: "user-1" }]);
});

test("updateSale raises no critical alert for a typed user error", { skip: moduleMocksUnavailable }, async () => {
  txOverrides.cashBankAccount = { findMany: async () => [cashAccount({ isActive: false })] };
  const { updateSale } = await import("../actions");

  const result = await updateSale("sale1", saleForm());

  assert.deepEqual(result, { error: "บัญชีเงินสด/ธนาคาร CASH-1 - เงินสด ถูกปิดใช้งานแล้ว" });
  assert.deepEqual(criticalReports, []);
});
