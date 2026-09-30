import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// R2 phase 1: a claim whose stock rows come before an ACTIVE supplier DN on the same SKU.
// Forward steps (send to supplier, close, return to customer) only add rows dated today,
// so they are allowed; reopen reverses rows and still stops at the DN boundary.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Where = { where?: Record<string, unknown> };

const calls: string[] = [];
const makeClient = (overrides: () => ModelOverrides) =>
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
                calls.push(`${modelName}.${method}`);
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

const CLAIM_NO = "WCM26090001";
const claimSendRow = { productId: "prod-1", docNo: `${CLAIM_NO}-S`, docDate: new Date("2026-09-20T00:00:00+07:00"), sorder: 3, valuationEpoch: 0 };
const debitRow = { productId: "prod-1", docNo: "SDN26090001", docDate: new Date("2026-09-29T00:00:00+07:00"), sorder: 8, valuationEpoch: 1 };
const trackedProduct = { inventoryTracking: "TRACKED", isLotControl: false };

let overrides: ModelOverrides = {};
let criticalReports: unknown[] = [];
let stockWrites = 0;

before(async () => {
  if (moduleMocksUnavailable) return;
  const client = makeClient(() => overrides);
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: client, dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(client) },
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
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", {
    namedExports: {
      ...realClaimStock,
      getOriginalClaimUnitCost: async () => ({ productId: "prod-1", lotNo: "", unitCost: 50 }),
      writeClaimStockMovement: async () => "movement-1",
      reverseClaimStockMovements: async () => undefined,
    },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        stockWrites += 1;
        return "sc-new";
      },
      recalculateStockCard: async () => undefined,
    },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

const claimRow = (fields: { status: string; outcome: string | null }) => ({
  id: "claim-1",
  claimNo: CLAIM_NO,
  claimType: "CUSTOMER_WAIT",
  ...fields,
  warranty: { id: "w-1", productId: "prod-1", product: trackedProduct },
  claimStockMovements: [],
});

beforeEach(() => {
  calls.length = 0;
  criticalReports = [];
  stockWrites = 0;
  overrides = {
    // The guard resolves the claim number, then the claim's rows and the later DN row.
    warrantyClaim: {
      findMany: async () => [{ claimNo: CLAIM_NO }],
      findUnique: async () => claimRow({ status: "SENT_TO_SUPPLIER", outcome: null }),
    },
    stockCard: {
      findMany: async (args) => ((args as Where).where?.source === "SUPPLIER_DEBIT" ? [debitRow] : [claimSendRow]),
    },
    supplierDebitNote: {
      findMany: async (args) => ((args as Where).where?.status === "ACTIVE" ? [{ id: "dn-1", debitNo: debitRow.docNo }] : []),
    },
  };
});

test("closing a claim (forward step) is allowed with a later active DN on the SKU", { skip: moduleMocksUnavailable }, async () => {
  const { closeClaim } = await import("../actions");
  const result = await closeClaim("claim-1", "RECEIVED", "2026-09-30");
  assert.deepEqual(result, {});
  assert.equal(stockWrites, 1, "the CLAIM_RECV_IN row dated today is written");
  assert.ok(calls.includes("warrantyClaim.update"));
  assert.deepEqual(criticalReports, []);
});

test("sending a claim to the supplier is allowed with a later active DN on the SKU", { skip: moduleMocksUnavailable }, async () => {
  overrides.warrantyClaim.findUnique = async () => ({
    ...claimRow({ status: "DRAFT", outcome: null }),
    warranty: { id: "w-1", lotNo: null, productId: "prod-1", product: trackedProduct },
  });
  const { sendClaimToSupplier } = await import("../actions");
  assert.deepEqual(await sendClaimToSupplier("claim-1", "2026-09-30"), {});
  assert.deepEqual(criticalReports, []);
});

test("reopening the claim still stops at the DN boundary, before any write", { skip: moduleMocksUnavailable }, async () => {
  overrides.warrantyClaim.findUnique = async () => claimRow({ status: "CLOSED", outcome: "RECEIVED" });
  const { reopenClaim } = await import("../actions");
  const result = await reopenClaim("claim-1");
  assert.ok(result.error?.includes("SDN26090001"), result.error);
  assert.ok(!calls.includes("stockCard.deleteMany"));
  assert.ok(!calls.includes("warrantyClaim.update"));
  assert.deepEqual(criticalReports, []);
});
