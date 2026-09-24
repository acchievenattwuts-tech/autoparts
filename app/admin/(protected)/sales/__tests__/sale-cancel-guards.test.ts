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
