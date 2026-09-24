import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// cancelSale / updateSale reference guard: a bill held by an ACTIVE delivery
// commission run cannot be cancelled or edited.

type Call = { method: string; args: unknown };

// ── cancelSale end-to-end with the DB and side-effect libraries module-mocked ──

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;

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
const criticalReports: unknown[] = [];

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
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
      },
    },
  });
  // Stock / cash / tax side effects are covered by their own tests; stub them here.
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCard: async () => undefined },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, clearCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, clearDocumentPayments: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: { ...realWhtReceived, cancelWhtReceivedForDocument: async () => undefined },
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

const activeSale = {
  id: "sale-1",
  saleNo: "SA202609200001",
  status: "ACTIVE",
  quotationId: null,
  trackingToken: null,
  updatedAt: SALE_UPDATED_AT,
  items: [{ id: "item-1", productId: "prod-1" }],
  creditNotes: [],
  receipts: [],
  // The pre-check only loads warranties with a non-cancelled claim.
  warranties: [],
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  criticalReports.length = 0;
  dbOverrides = { sale: { findUnique: async () => activeSale } };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
  };
});

const cancelForm = () => {
  const formData = new FormData();
  formData.set("saleId", "sale-1");
  formData.set("cancelNote", "ทดสอบ");
  return formData;
};

test(
  "cancelSale is refused before any write while an ACTIVE delivery commission run holds the bill",
  { skip: moduleMocksUnavailable },
  async () => {
    dbOverrides.deliveryCommissionItem = {
      findMany: async () => [{ run: { id: "run-1", runNo: "DCP26090001" } }],
    };
    const { cancelSale } = await import("../actions");

    const result = await cancelSale(cancelForm());

    assert.deepEqual(result, {
      error: "ไม่สามารถดำเนินการได้ เนื่องจากบิลนี้ถูกทำจ่ายค่าส่งแล้ว กรุณายกเลิกเอกสารทำจ่ายก่อน: DCP26090001",
    });
    assert.deepEqual(txCalls, [], "no transaction work at all");
    const commissionQuery = dbCalls.find((call) => call.method === "deliveryCommissionItem.findMany");
    assert.deepEqual((commissionQuery?.args as { where: unknown }).where, {
      activeSaleId: "sale-1",
      run: { status: "ACTIVE" },
    });
  },
);

test(
  "updateSale is refused before parsing or writing while an ACTIVE delivery commission run holds the bill",
  { skip: moduleMocksUnavailable },
  async () => {
    dbOverrides = {
      sale: { findUnique: async () => ({ ...activeSale, channel: "STORE", user: null, items: [] }) },
      deliveryCommissionItem: {
        findMany: async () => [{ run: { id: "run-1", runNo: "DCP26090001" } }],
      },
    };
    const { updateSale } = await import("../actions");

    const result = await updateSale("sale1", new FormData());

    assert.deepEqual(result, {
      error: "ไม่สามารถดำเนินการได้ เนื่องจากบิลนี้ถูกทำจ่ายค่าส่งแล้ว กรุณายกเลิกเอกสารทำจ่ายก่อน: DCP26090001",
    });
    assert.deepEqual(txCalls, []);
  },
);

// ── In-transaction guard re-check (after the Sale row lock) ──────────────────
// A receipt / credit note created after the pre-check is caught by the guard
// re-run inside the transaction. The user gets the same guard message as the
// pre-check, with the blocking document numbers, and no critical alert is raised.

const updateForm = () => {
  const formData = new FormData();
  formData.set("saleDate", "2026-09-20");
  formData.set("customerId", "cust-1");
  formData.set("paymentType", "CREDIT_SALE");
  formData.set(
    "items",
    JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 100 }]),
  );
  return formData;
};

const existingSaleForUpdate = () => ({
  ...activeSale,
  channel: "STORE",
  customerId: "cust-1",
  saleDate: new Date("2026-09-20T00:00:00.000+07:00"),
  user: null,
  items: [],
});

/** Transaction writes that must never run once the in-transaction guard blocks. */
const WRITE_METHODS = /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)$/;

test(
  "cancelSale returns the guard message with the receipt number when a receipt appears after the pre-check",
  { skip: moduleMocksUnavailable },
  async () => {
    txOverrides.receiptItem = {
      findMany: async () => [{ receipt: { id: "rc-1", receiptNo: "RC26090001" } }],
    };
    const { cancelSale } = await import("../actions");

    const result = await cancelSale(cancelForm());

    assert.deepEqual(result, {
      error: "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: RC26090001",
    });
    assert.deepEqual(criticalReports, [], "a user condition raises no critical alert");
    assert.deepEqual(
      txCalls.filter((call) => WRITE_METHODS.test(call.method)).map((call) => call.method),
      [],
      "nothing is written after the guard blocks",
    );
  },
);

test(
  "updateSale returns the guard message with the credit note number when a credit note appears after the pre-check",
  { skip: moduleMocksUnavailable },
  async () => {
    dbOverrides.sale = { findUnique: async () => existingSaleForUpdate() };
    txOverrides.creditNote = {
      findMany: async () => [{ id: "cn-1", cnNo: "CN26090001" }],
    };
    const consoleError = mock.method(console, "error", () => undefined);
    const { updateSale } = await import("../actions");

    try {
      const result = await updateSale("sale1", updateForm());

      assert.deepEqual(result, {
        error: "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: CN26090001",
      });
      assert.equal(consoleError.mock.callCount(), 0, "handled as a user condition, not logged as a failure");
      assert.deepEqual(criticalReports, []);
      assert.deepEqual(
        txCalls.filter((call) => WRITE_METHODS.test(call.method)).map((call) => call.method),
        [],
      );
    } finally {
      consoleError.mock.restore();
    }
  },
);

test(
  "updateSale returns the Thai missing-unit message instead of the generic error",
  { skip: moduleMocksUnavailable },
  async () => {
    dbOverrides.sale = { findUnique: async () => existingSaleForUpdate() };
    txOverrides.product = {
      findMany: async () => [
        {
          id: "prod-1",
          avgCost: 50,
          costPrice: 50,
          salePrice: 100,
          retailPrice: 100,
          memberPrice: 100,
          inventoryTracking: "TRACKED",
          isLotControl: false,
        },
      ],
    };
    const consoleError = mock.method(console, "error", () => undefined);
    const { updateSale } = await import("../actions");

    try {
      const result = await updateSale("sale1", updateForm());

      assert.deepEqual(result, { error: "ไม่พบหน่วยนับ ชิ้น ของสินค้า" });
      assert.equal(consoleError.mock.callCount(), 0);
      assert.deepEqual(criticalReports, []);
    } finally {
      consoleError.mock.restore();
    }
  },
);
