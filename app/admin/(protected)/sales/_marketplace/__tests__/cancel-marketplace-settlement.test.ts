import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// cancelMarketplaceSettlement: the pre-transaction status read is only a fast
// path. The MarketplaceSettlement row is locked FIRST inside the transaction and
// its status and generated document ids re-read, so a second cancel that passed
// the stale pre-check stops before clearing cash/bank movements or cancelling
// the transfer, expense and adjustment a second time.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

type SettlementRow = {
  status: string;
  expenseId: string | null;
  cashBankTransferId: string;
  cashBankAdjustmentId: string | null;
};

// Snapshot returned by the pre-transaction read (null = not found).
let preReadSettlement: {
  settlementNo: string;
  status: string;
  channel: string;
  payoutRef: string;
  cashBankAdjustmentId: string | null;
} | null;
// Row the transaction sees under the lock (null = row missing).
let settlementInTx: SettlementRow | null;
// Ordered trace of the lock and every write the cancel can make.
let callLog: string[] = [];
let dbTxCalls = 0;
let consoleErrors = 0;
let notifications = 0;

const record = (entry: string) => {
  callLog.push(entry);
};

const updateRecorder = (model: string) => async (args: unknown) => {
  const { where } = args as { where: { id: string } };
  record(`${model}.update:${where.id}`);
  return {};
};

const fakeTx: FakeTx = {
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return settlementInTx === null ? [] : [{ ...settlementInTx }];
  },
  cashBankTransfer: { update: updateRecorder("cashBankTransfer") },
  expense: { update: updateRecorder("expense") },
  cashBankAdjustment: { update: updateRecorder("cashBankAdjustment") },
  marketplaceSettlementLine: {
    updateMany: async () => {
      record("marketplaceSettlementLine.updateMany");
      return { count: 3 };
    },
  },
  marketplaceSettlement: {
    update: async (args: unknown) => {
      const { where, data } = args as { where: { id: string }; data: { status?: string } };
      record(`marketplaceSettlement.update:${where.id}`);
      if (settlementInTx && data.status) settlementInTx.status = data.status;
      return {};
    },
  },
};

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "user-1" } }) },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async (_tx: unknown, type: string, sourceId: string) => {
        record(`cashBank.clear:${type}:${sourceId}`);
      },
      replaceCashBankSourceMovements: async () => {
        record("cashBank.replace");
      },
    },
  });
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      rebuildMarketplaceSettlementProfitFacts: async (_tx: unknown, settlementId: string) => {
        record(`profitFacts.rebuild:${settlementId}`);
      },
    },
  });
  await mock.module("@/lib/profit-cache", {
    namedExports: { revalidateProfitDashboardCache: () => undefined },
  });
  await mock.module("@/lib/notifications", {
    namedExports: {
      notifyMarketplaceSettlementCancelled: async () => {
        notifications += 1;
      },
      notifyMarketplaceSettlementRecorded: async () => undefined,
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateCashBankAdjustmentNo: async () => "CBA26090001",
      generateCashBankTransferNo: async () => "CBT26090001",
      generateExpenseNo: async () => "OE26090001",
      generateMarketplaceSettlementNo: async () => "LZS26090001",
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        marketplaceSettlement: {
          findUnique: async () => (preReadSettlement ? { ...preReadSettlement } : null),
        },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => {
        dbTxCalls += 1;
        return fn(fakeTx);
      },
    },
  });
  mock.method(console, "error", () => {
    consoleErrors += 1;
  });
  actions = await import("../actions");
});

const activePreRead = () => ({
  settlementNo: "LZS26090001",
  status: "ACTIVE",
  channel: "LAZADA",
  payoutRef: "PAYOUT-1",
  cashBankAdjustmentId: "adj-1",
});

const EXPECTED_CANCEL_TRACE = [
  "lock:MarketplaceSettlement:set-1",
  "cashBank.clear:TRANSFER:tr-1",
  "cashBankTransfer.update:tr-1",
  "cashBank.clear:EXPENSE:exp-1",
  "expense.update:exp-1",
  "cashBank.clear:ADJUSTMENT:adj-1",
  "cashBankAdjustment.update:adj-1",
  "marketplaceSettlementLine.updateMany",
  "marketplaceSettlement.update:set-1",
  "profitFacts.rebuild:set-1",
];

beforeEach(() => {
  preReadSettlement = activePreRead();
  settlementInTx = {
    status: "ACTIVE",
    expenseId: "exp-1",
    cashBankTransferId: "tr-1",
    cashBankAdjustmentId: "adj-1",
  };
  callLog = [];
  dbTxCalls = 0;
  consoleErrors = 0;
  notifications = 0;
});

test("cancel locks the MarketplaceSettlement row before any write", async () => {
  const result = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, EXPECTED_CANCEL_TRACE);
  assert.equal(notifications, 1);
});

test("the lock is a parameterized SELECT ... FOR UPDATE on the settlement id", async () => {
  let captured: { sql: string; values: unknown[] } | null = null;
  const original = fakeTx.$queryRaw as FakeFn;
  fakeTx.$queryRaw = async (query: unknown) => {
    captured = query as { sql: string; values: unknown[] };
    return original(query);
  };
  try {
    await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  } finally {
    fakeTx.$queryRaw = original;
  }
  assert.ok(captured);
  const { sql, values } = captured as { sql: string; values: unknown[] };
  assert.match(
    sql,
    /SELECT "status"::text AS "status", "expenseId", "cashBankTransferId", "cashBankAdjustmentId"\s+FROM "MarketplaceSettlement"\s+WHERE id = \?\s+FOR UPDATE/,
  );
  assert.deepEqual(values, ["set-1"]);
});

test("a second cancel that passed the stale pre-check sees CANCELLED and makes no writes", async () => {
  // Both requests read ACTIVE before their transactions (preReadSettlement stays ACTIVE).
  const first = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(first, { success: true });
  assert.equal(settlementInTx?.status, "CANCELLED");

  callLog = [];
  notifications = 0;
  const second = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(second, { error: "รอบรับเงินนี้ถูกยกเลิกไปแล้ว" });
  assert.deepEqual(callLog, ["lock:MarketplaceSettlement:set-1"]);
  assert.equal(notifications, 0);
  assert.equal(consoleErrors, 0);
});

test("a settlement missing under the lock returns the not-found message and makes no writes", async () => {
  settlementInTx = null;
  const result = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(result, { error: "ไม่พบรอบรับเงิน" });
  assert.deepEqual(callLog, ["lock:MarketplaceSettlement:set-1"]);
  assert.equal(consoleErrors, 0);
});

test("a settlement without fee expense or income adjustment only cancels the transfer", async () => {
  preReadSettlement = { ...activePreRead(), cashBankAdjustmentId: null };
  settlementInTx = {
    status: "ACTIVE",
    expenseId: null,
    cashBankTransferId: "tr-1",
    cashBankAdjustmentId: null,
  };
  const result = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [
    "lock:MarketplaceSettlement:set-1",
    "cashBank.clear:TRANSFER:tr-1",
    "cashBankTransfer.update:tr-1",
    "marketplaceSettlementLine.updateMany",
    "marketplaceSettlement.update:set-1",
    "profitFacts.rebuild:set-1",
  ]);
});

test("the fast path rejects an already-cancelled settlement without opening a transaction", async () => {
  preReadSettlement = { ...activePreRead(), status: "CANCELLED" };
  const result = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
  assert.deepEqual(result, { error: "รอบรับเงินนี้ถูกยกเลิกไปแล้ว" });
  assert.equal(dbTxCalls, 0);
  assert.deepEqual(callLog, []);
});

test("an unexpected error inside the transaction is logged and returns the generic message", async () => {
  const lines = fakeTx.marketplaceSettlementLine as Record<string, FakeFn>;
  const original = lines.updateMany;
  lines.updateMany = async () => {
    throw new Error("connection reset");
  };
  try {
    const result = await actions.cancelMarketplaceSettlement("set-1", "โอนซ้ำ");
    assert.deepEqual(result, { error: "ยกเลิกรอบรับเงินไม่สำเร็จ" });
    assert.equal(consoleErrors, 1);
  } finally {
    lines.updateMany = original;
  }
});
