import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// cancelDeliveryCommissionRun: the pre-transaction status read is only a fast
// path. The DeliveryCommissionRun row is locked FIRST inside the transaction and
// its status and expenseId re-read, so a second cancel that passed the stale
// pre-check stops before touching the expense, cash/bank or profit facts.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

type RunRow = { status: string; expenseId: string | null };

// Snapshot returned by the pre-transaction read (null = not found).
let preReadRun: { id: string; runNo: string; status: string; expenseId: string | null } | null;
// Row the transaction sees under the lock (null = row missing).
let runInTx: RunRow | null;
// Ordered trace of the lock and every write the cancel can make.
let callLog: string[] = [];
let dbTxCalls = 0;
let consoleErrors = 0;

const recordWrite = (entry: string) => {
  callLog.push(entry);
};

const fakeTx: FakeTx = {
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    callLog.push(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return runInTx === null ? [] : [{ ...runInTx }];
  },
  expense: {
    update: async (args: unknown) => {
      const { where } = args as { where: { id: string } };
      recordWrite(`expense.update:${where.id}`);
      return {};
    },
  },
  deliveryCommissionItem: {
    updateMany: async () => {
      recordWrite("deliveryCommissionItem.updateMany");
      return { count: 2 };
    },
  },
  deliveryCommissionRun: {
    update: async (args: unknown) => {
      const { data } = args as { data: { status?: string } };
      recordWrite("deliveryCommissionRun.update");
      if (runInTx && data.status) runInTx.status = data.status;
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
      diffEntity: (before: unknown, after: unknown) => ({ before, after }),
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
      clearCashBankSourceMovements: async (_tx: unknown, _type: unknown, sourceId: string) => {
        recordWrite(`cashBank.clear:${sourceId}`);
      },
      replaceCashBankSourceMovements: async () => {
        recordWrite("cashBank.replace");
      },
    },
  });
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      rebuildExpenseProfitFacts: async (_tx: unknown, expenseId: string) => {
        recordWrite(`profitFacts.rebuild:${expenseId}`);
      },
    },
  });
  await mock.module("@/lib/profit-cache", {
    namedExports: { revalidateProfitDashboardCache: () => undefined },
  });
  await mock.module("@/lib/site-config", {
    namedExports: { getSiteConfig: async () => ({ deliveryCommissionPercent: 10 }) },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateDeliveryCommissionRunNo: async () => "DCP26090001",
      generateExpenseNo: async () => "EXP26090001",
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        deliveryCommissionRun: {
          findUnique: async () => (preReadRun ? { ...preReadRun, items: [] } : null),
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

const activeRun = () => ({ id: "run-1", runNo: "DCP26090001", status: "ACTIVE", expenseId: "exp-1" });

const cancelForm = () => {
  const form = new FormData();
  form.set("runId", "run-1");
  return form;
};

const EXPECTED_CANCEL_TRACE = [
  "lock:DeliveryCommissionRun:run-1",
  "cashBank.clear:exp-1",
  "expense.update:exp-1",
  "profitFacts.rebuild:exp-1",
  "deliveryCommissionItem.updateMany",
  "deliveryCommissionRun.update",
];

beforeEach(() => {
  preReadRun = activeRun();
  runInTx = { status: "ACTIVE", expenseId: "exp-1" };
  callLog = [];
  dbTxCalls = 0;
  consoleErrors = 0;
});

test("cancel locks the DeliveryCommissionRun row before any write", async () => {
  const result = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, EXPECTED_CANCEL_TRACE);
});

test("the lock is a parameterized SELECT ... FOR UPDATE on the run id", async () => {
  let captured: { sql: string; values: unknown[] } | null = null;
  const original = fakeTx.$queryRaw as FakeFn;
  fakeTx.$queryRaw = async (query: unknown) => {
    captured = query as { sql: string; values: unknown[] };
    return original(query);
  };
  try {
    await actions.cancelDeliveryCommissionRun(cancelForm());
  } finally {
    fakeTx.$queryRaw = original;
  }
  assert.ok(captured);
  const { sql, values } = captured as { sql: string; values: unknown[] };
  assert.match(sql, /SELECT "status"::text AS "status", "expenseId"\s+FROM "DeliveryCommissionRun"\s+WHERE id = \?\s+FOR UPDATE/);
  assert.deepEqual(values, ["run-1"]);
});

test("a second cancel that passed the stale pre-check sees CANCELLED and makes no writes", async () => {
  // Both requests read ACTIVE before their transactions (preReadRun stays ACTIVE).
  const first = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(first, { success: true });
  assert.equal(runInTx?.status, "CANCELLED");

  callLog = [];
  const second = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(second, { error: "เอกสารถูกยกเลิกแล้ว" });
  assert.deepEqual(callLog, ["lock:DeliveryCommissionRun:run-1"]);
  assert.equal(consoleErrors, 0);
});

test("a run missing under the lock returns the not-found message and makes no writes", async () => {
  runInTx = null;
  const result = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(result, { error: "ไม่พบเอกสาร" });
  assert.deepEqual(callLog, ["lock:DeliveryCommissionRun:run-1"]);
  assert.equal(consoleErrors, 0);
});

test("the expense cancelled is the one read under the lock, not the pre-read snapshot", async () => {
  preReadRun = { ...activeRun(), expenseId: "exp-stale" };
  runInTx = { status: "ACTIVE", expenseId: "exp-1" };
  const result = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, EXPECTED_CANCEL_TRACE);
});

test("a run without a generated expense skips the expense, cash/bank and profit writes", async () => {
  runInTx = { status: "ACTIVE", expenseId: null };
  const result = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [
    "lock:DeliveryCommissionRun:run-1",
    "deliveryCommissionItem.updateMany",
    "deliveryCommissionRun.update",
  ]);
});

test("the fast path rejects an already-cancelled run without opening a transaction", async () => {
  preReadRun = { ...activeRun(), status: "CANCELLED" };
  const result = await actions.cancelDeliveryCommissionRun(cancelForm());
  assert.deepEqual(result, { error: "เอกสารถูกยกเลิกแล้ว" });
  assert.equal(dbTxCalls, 0);
  assert.deepEqual(callLog, []);
});

test("an unexpected error inside the transaction is logged and returns the generic message", async () => {
  const original = (fakeTx.deliveryCommissionItem as Record<string, FakeFn>).updateMany;
  (fakeTx.deliveryCommissionItem as Record<string, FakeFn>).updateMany = async () => {
    throw new Error("connection reset");
  };
  try {
    const result = await actions.cancelDeliveryCommissionRun(cancelForm());
    assert.deepEqual(result, { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
    assert.equal(consoleErrors, 1);
  } finally {
    (fakeTx.deliveryCommissionItem as Record<string, FakeFn>).updateMany = original;
  }
});
