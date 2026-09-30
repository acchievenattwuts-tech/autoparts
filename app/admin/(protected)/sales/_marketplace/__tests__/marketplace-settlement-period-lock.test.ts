import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on marketplace settlements (owner decision T2 / ก1), keyed on the settlement date:
// recording one dated in a month whose profit was distributed is refused (no override); cancelling
// one is refused unless an admin with period_lock.override gives a reason (audited + alerted).
// Both checks run after the row locks and before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const SETTLEMENT_DATE = parseDateOnlyToDate("2026-08-25");

// The settlement row the cancel reads under its lock (S2 tests date it in an open month).
let lockedSettlement: { settlementDate: Date; expenseId: string | null } = { settlementDate: SETTLEMENT_DATE, expenseId: null };

const lockedRowsFor = (sql: string): unknown[] => {
  if (/"MarketplaceSettlement"/.test(sql)) {
    return [{
      status: "ACTIVE",
      expenseId: lockedSettlement.expenseId,
      cashBankTransferId: "tr-1",
      cashBankAdjustmentId: null,
      settlementDate: lockedSettlement.settlementDate,
    }];
  }
  if (/"Sale"/.test(sql)) return [{ id: "sale-a", status: "ACTIVE" }];
  return [];
};

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return modelName === "$queryRaw" ? lockedRowsFor((query as { sql: string }).sql) : 0;
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

const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const sideWrites: string[] = [];
let declaredPeriods: Record<string, string> = {};
let sessionPermissions: string[] = [];
let rebuildResult: unknown = undefined;
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];

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
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      notifyMarketplaceSettlementCancelled: async () => 0,
      notifyMarketplaceSettlementRecorded: async () => 0,
      safeNotifyPeriodLockOverride: async (input: Record<string, unknown>) => {
        alerts.push(input);
      },
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "เจ้าของร้าน", permissions: sessionPermissions } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (input: Record<string, unknown>) => {
        audits.push(input);
      },
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.clear");
      },
      replaceCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.replace");
      },
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      ...realProfitFact,
      rebuildMarketplaceSettlementProfitFacts: async () => {
        sideWrites.push("profitFacts.rebuild");
        return rebuildResult;
      },
    },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: {
      ...realDocNumber,
      generateCashBankAdjustmentNo: async () => "CBA26080001",
      generateCashBankTransferNo: async () => "CBT26080001",
      generateExpenseNo: async () => "OE26080001",
      generateMarketplaceSettlementNo: async () => "SPS26080001",
    },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", {
    namedExports: { ...realNextCache, revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
});

beforeEach(() => {
  txCalls.length = 0;
  sideWrites.length = 0;
  audits.length = 0;
  alerts.length = 0;
  rebuildResult = undefined;
  lockedSettlement = { settlementDate: SETTLEMENT_DATE, expenseId: null };
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = [
    "marketplace.manage",
    "expenses.create",
    "expenses.cancel",
    "cash_bank.transfers.create",
    "cash_bank.transfers.cancel",
    "cash_bank.adjustments.create",
    "cash_bank.adjustments.cancel",
  ];
  dbOverrides = {
    marketplaceChannelSetting: {
      findFirst: async () => ({ id: "setting-1", settlementCashBankAccountId: "hold-1" }),
    },
    sale: {
      findMany: async () => [{ id: "sale-a", saleNo: "SP26080001", saleDate: SETTLEMENT_DATE, netAmount: 500 }],
    },
    marketplaceSettlement: {
      findUnique: async () => ({
        settlementNo: "SPS26080001",
        status: "ACTIVE",
        channel: "SHOPEE",
        payoutRef: "PAYOUT-1",
        cashBankAdjustmentId: null,
        settlementDate: SETTLEMENT_DATE,
      }),
    },
  };
  txOverrides = {
    sale: { findMany: async () => [{ id: "sale-a", netAmount: 500 }] },
    cashBankAccount: { findFirst: async () => ({ id: "bank-1" }) },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const payload = () => ({
  channel: "SHOPEE",
  settlementDate: "2026-08-25",
  payoutRef: "PAYOUT-1",
  destinationAccountId: "bank-1",
  payoutAmount: 500,
  saleIds: ["sale-a"],
  creditNoteIds: [],
  lines: [],
});

const REASON = "แพลตฟอร์มโอนซ้ำ ต้องยกเลิกรอบเดิม";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(alerts.length, 0);
};

test("recording a settlement dated in a distributed month is refused after the row locks, before any write", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { createMarketplaceSettlement } = await import("../actions");
  const result = await createMarketplaceSettlement(payload());
  assertRejectedWithoutWrites(result);
  assert.ok(!("error" in result && result.error?.includes("ปลดล็อก")), "no override when recording");
  const saleLock = txCalls.findIndex((call) => call.method === "$queryRaw");
  const periodLock = txCalls.findIndex((call) => call.method === "profitDistribution.findMany");
  assert.ok(saleLock >= 0 && periodLock > saleLock, "month lock after the document row locks");
});

test("cancelling: refused without the permission or with an empty reason", { skip: moduleMocksUnavailable }, async () => {
  const { cancelMarketplaceSettlement } = await import("../actions");
  assertRejectedWithoutWrites(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", REASON));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", "  "));
});

test("cancelling: an admin with a reason cancels; the reason is audited and alerted", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { cancelMarketplaceSettlement } = await import("../actions");
  assert.deepEqual(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", REASON), { success: true });
  assert.ok(sideWrites.includes("profitFacts.rebuild"));
  const meta = audits[0]?.meta as { cancelNote: string; periodLockOverride?: { reason: string } };
  assert.equal(meta.cancelNote, "โอนซ้ำ");
  assert.equal(meta.periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "SPS26080001");
  assert.equal(alerts[0].link, "/admin/marketplace/settlements/set-1");
});

test("P2 = B: an open-month settlement of a sale in a distributed month is recorded; the sale month is share-locked before createdAt is stamped and the moved shares are audited", { skip: moduleMocksUnavailable }, async () => {
  rebuildResult = {
    settlementDate: parseDateOnlyToDate("2026-09-05"),
    moved: [{
      docNo: "SP26080001",
      docDate: SETTLEMENT_DATE,
      periodKey: "2026-08",
      distributionNo: "PD2026080001",
      feeAmount: 12.5,
      incomeAmount: 0,
    }],
  };
  const { createMarketplaceSettlement } = await import("../actions");
  const startedAt = Date.now();
  const result = await createMarketplaceSettlement({ ...payload(), settlementDate: "2026-09-05" });
  assert.equal("success" in result && result.success, true, JSON.stringify(result));

  const saleMonthLock = txCalls.findIndex(
    (call) => call.method === "$executeRaw" && (call.args as { values?: unknown[] }).values?.includes("period-lock:2026-08"),
  );
  const insert = txCalls.findIndex((call) => call.method === "marketplaceSettlement.create");
  assert.ok(saleMonthLock >= 0 && insert > saleMonthLock, "sale month share-locked before the settlement insert");
  const createdAt = (txCalls[insert].args as { data: { createdAt?: unknown } }).data.createdAt;
  assert.ok(createdAt instanceof Date && createdAt.getTime() >= startedAt, "createdAt stamped after the locks");

  const meta = audits[0]?.meta as { factDating: { settlementDate: string; movedToSettlementDate: Array<Record<string, unknown>> } };
  assert.equal(meta.factDating.settlementDate, "2026-09-05");
  assert.deepEqual(meta.factDating.movedToSettlementDate, [{
    saleNo: "SP26080001",
    saleDate: "2026-08-25",
    periodKey: "2026-08",
    distributionNo: "PD2026080001",
    feeAmount: 12.5,
    incomeAmount: 0,
  }]);
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { createMarketplaceSettlement, cancelMarketplaceSettlement } = await import("../actions");
  const created = await createMarketplaceSettlement(payload());
  assert.equal("success" in created && created.success, true);
  assert.deepEqual(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ"), { success: true });
  assert.equal(alerts.length, 0);
});

// Owner decision S2: a settlement recorded while a sale month was open keeps that sale's fee /
// income facts on the sale date (P2 = B). Once that month is declared, cancelling the settlement
// changes it, so the cancel needs the override even though the settlement date's month is open.
const SEPTEMBER_SETTLEMENT_DATE = parseDateOnlyToDate("2026-09-05");
const AUGUST_SALE_DATE = parseDateOnlyToDate("2026-08-20");

const withFactDates = (dates: Date[]): void => {
  lockedSettlement = { settlementDate: SEPTEMBER_SETTLEMENT_DATE, expenseId: "exp-1" };
  txOverrides.factProfit = {
    findMany: async () => dates.map((businessDate) => ({ sourceType: "EXPENSE", sourceId: "exp-1", businessDate })),
  };
};

test("S2: cancelling an open-month settlement whose shares are still dated in a month declared since needs the override", { skip: moduleMocksUnavailable }, async () => {
  withFactDates([SEPTEMBER_SETTLEMENT_DATE, AUGUST_SALE_DATE]);
  const { cancelMarketplaceSettlement } = await import("../actions");
  assertRejectedWithoutWrites(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", REASON));

  // Read after the settlement row lock, before the month check; both fact sources of this settlement.
  const rowLock = txCalls.findIndex((call) => call.method === "$queryRaw");
  const factRead = txCalls.findIndex((call) => call.method === "factProfit.findMany");
  const monthCheck = txCalls.findIndex((call) => call.method === "profitDistribution.findMany");
  assert.ok(rowLock >= 0 && factRead > rowLock && monthCheck > factRead, "row lock → fact dates → month lock");
  assert.deepEqual((txCalls[factRead].args as { where: unknown }).where, {
    isActive: true,
    OR: [
      { sourceType: "OTHER_INCOME", sourceId: { in: ["set-1"] } },
      { sourceType: "EXPENSE", sourceId: { in: ["exp-1"] } },
    ],
  });

  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", "  "));
  assert.deepEqual(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ", REASON), { success: true });
  assert.ok(sideWrites.includes("profitFacts.rebuild"));
  const meta = audits[0]?.meta as { periodLockOverride?: { reason: string; periods: Array<{ periodKey: string; distributionNo: string }> } };
  assert.equal(meta.periodLockOverride?.reason, REASON);
  assert.deepEqual(
    meta.periodLockOverride?.periods.map((period) => [period.periodKey, period.distributionNo]),
    [["2026-08", "PD2026080001"]],
  );
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].periodLabels, ["สิงหาคม 2026"]);
  assert.equal(alerts[0].docNo, "SPS26080001");
});

test("S2: no override when the shares sit only in open months or were moved to the settlement date", { skip: moduleMocksUnavailable }, async () => {
  const { cancelMarketplaceSettlement } = await import("../actions");
  // August was declared before recording, so its share was booked on the (open) settlement date.
  withFactDates([SEPTEMBER_SETTLEMENT_DATE]);
  assert.deepEqual(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ"), { success: true });
  // The sale month is still open.
  declaredPeriods = {};
  withFactDates([SEPTEMBER_SETTLEMENT_DATE, AUGUST_SALE_DATE]);
  assert.deepEqual(await cancelMarketplaceSettlement("set-1", "โอนซ้ำ"), { success: true });
  assert.equal(alerts.length, 0);
  assert.ok(audits.every((audit) => !(audit.meta as { periodLockOverride?: unknown }).periodLockOverride));
});
