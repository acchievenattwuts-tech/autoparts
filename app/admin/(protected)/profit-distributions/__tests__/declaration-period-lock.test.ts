import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Declaring or cancelling a profit distribution takes the EXCLUSIVE month lock
// (lockPeriodForDeclaration, lib/period-lock.ts) as the first statement of its transaction.
// Documents of that month take the SHARED lock inside their own transactions, so a declaration
// waits for in-flight document checks and new document checks wait for the declaration.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };
type RawQuery = { sql: string; values: unknown[] };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return modelName === "$queryRaw" ? [] : 0;
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

let dbOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const sideWrites: string[] = [];

const distributionRow = {
  id: "pd-1",
  distributionNo: "PD2026080001",
  status: "ACTIVE",
  periodYear: 2026,
  periodMonth: 8,
  items: [],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => ({ profitDistribution: { create: async () => ({ id: "pd-1" }) } }), txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, []),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realDistribution = await import("@/lib/profit-distribution");
  await mock.module("@/lib/profit-distribution", {
    namedExports: {
      ...realDistribution,
      isClosedPeriod: () => true,
      isBeforeStartPeriod: () => false,
      listUndeclaredPriorPeriods: async () => [],
      getPeriodProfitSummary: async () => ({
        salesAmountExVat: 5000,
        costAmount: 3000,
        expenseAmount: 1000,
        grossProfit: 2000,
        netProfitAmount: 1000,
      }),
      computeCarryForward: async () => ({ amount: 0, rows: [] }),
    },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      notifyProfitDistributionDeclared: async () => 0,
      notifyProfitDistributionCancelled: async () => 0,
    },
  });
  const realLedger = await import("@/lib/partner-ledger");
  await mock.module("@/lib/partner-ledger", {
    namedExports: {
      ...realLedger,
      replacePartnerLedgerSourceEntries: async () => {
        sideWrites.push("ledger.replace");
      },
      clearPartnerLedgerSourceEntries: async () => {
        sideWrites.push("ledger.clear");
      },
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      replaceCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.replace");
      },
      clearCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.clear");
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateProfitDistributionNo: async () => "PD2026080001" },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: { ...realAuth, requirePermission: async () => ({ user: { id: "owner-1", name: "เจ้าของร้าน" } }) },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  txCalls.length = 0;
  sideWrites.length = 0;
  dbOverrides = {
    cashBankAccount: { findUnique: async () => ({ id: "acc-1", isActive: true }) },
    partnerProfile: {
      findMany: async () => [{ id: "pp-1", userId: "u-1", user: { name: "หุ้นส่วน", isActive: true } }],
    },
    profitDistribution: { findUnique: async () => distributionRow },
  };
});

/** The month lock must be the transaction's first statement, and exclusive (not the shared variant). */
const assertExclusiveMonthLockFirst = () => {
  const first = txCalls[0];
  assert.equal(first?.method, "$executeRaw");
  const { sql, values } = first.args as RawQuery;
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(/);
  assert.doesNotMatch(sql, /_shared/);
  assert.deepEqual(values, ["period-lock:2026-08"]);
};

test("declaring a month takes its exclusive month lock before any write", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides.profitDistribution = { findUnique: async () => null };
  const { createProfitDistribution } = await import("../actions");
  const form = new FormData();
  form.set("periodKey", "2026-08");
  form.set("payDate", "2026-08-31");
  form.set("cashBankAccountId", "acc-1");
  form.set("distributedAmount", "1000");
  form.set("retainedMode", "KEEP_IN_SHOP");
  form.set("items", JSON.stringify([{ partnerProfileId: "pp-1", sharePercent: 100, shareAmount: 1000 }]));

  const result = await createProfitDistribution(form);

  assert.equal(result.error, undefined, result.error);
  assertExclusiveMonthLockFirst();
  assert.ok(txCalls.some((call) => call.method === "profitDistribution.create"));
});

test("cancelling a declaration takes the same exclusive month lock before any write", { skip: moduleMocksUnavailable }, async () => {
  const { cancelProfitDistribution } = await import("../actions");
  const form = new FormData();
  form.set("distributionId", "pd-1");

  const result = await cancelProfitDistribution(form);

  assert.deepEqual(result.error, undefined, result.error);
  assertExclusiveMonthLockFirst();
  assert.ok(txCalls.some((call) => call.method === "profitDistribution.update"));
  assert.deepEqual(sideWrites, ["cashBank.clear", "ledger.clear"]);
});
