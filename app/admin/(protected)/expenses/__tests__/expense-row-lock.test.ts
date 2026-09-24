import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import {
  DELIVERY_COMMISSION_EXPENSE_REASON,
  MARKETPLACE_SETTLEMENT_SOURCE_REASON,
} from "@/lib/document-mutation-guard";

// cancelExpense / updateExpense: the pre-transaction status and mutation-guard
// reads are only fast paths. The Expense row is locked FIRST inside the
// transaction, its status re-read, and the Expense guard (ACTIVE delivery
// commission run / marketplace settlement) re-run on the transaction client, so
// a request that passed a stale pre-check stops before touching cash/bank
// movements, document payments, WHT certificates or profit facts.
//
// The real document-mutation-guard runs here; only the database is faked.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;
type Ref = { id: string; runNo?: string; settlementNo?: string };

// Expense returned by the pre-transaction read (null = not found).
let preReadStatus: string | null;
// Row status the transaction sees under the lock (null = row missing).
let statusInTx: string | null;
// Blocking documents visible to the pre-check (db) and inside the transaction (tx).
let preReadRuns: Ref[];
let txRuns: Ref[];
let txSettlements: Ref[];
// Ordered trace of the lock, guard reads and every write the flows can make.
let callLog: string[] = [];
let auditWrites = 0;
let consoleErrors = 0;
let dbTxCalls = 0;

const record = (entry: string) => {
  callLog.push(entry);
};

const fakeTx: FakeTx = {
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return statusInTx === null ? [] : [{ status: statusInTx }];
  },
  deliveryCommissionRun: {
    findMany: async () => {
      record("guard:DeliveryCommissionRun");
      return txRuns;
    },
  },
  marketplaceSettlement: {
    findMany: async () => {
      record("guard:MarketplaceSettlement");
      return txSettlements;
    },
  },
  expense: {
    update: async (args: unknown) => {
      const { data } = args as { data: { status?: string } };
      record(data.status ? `expense.update:${data.status}` : "expense.update");
      if (data.status && statusInTx !== null) statusInTx = data.status;
      return {};
    },
  },
  expenseItem: {
    deleteMany: async () => {
      record("expenseItem.deleteMany");
      return { count: 1 };
    },
    createMany: async () => {
      record("expenseItem.createMany");
      return { count: 1 };
    },
  },
  documentPayment: {
    deleteMany: async () => {
      record("documentPayment.deleteMany");
      return { count: 1 };
    },
    createMany: async () => {
      record("documentPayment.createMany");
      return { count: 1 };
    },
  },
};

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  mock.method(console, "error", () => {
    consoleErrors += 1;
  });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (before: unknown, after: unknown) => ({ before, after }),
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => {
        auditWrites += 1;
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "user-1" } }) },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: { generateExpenseNo: async () => "EX26090001" },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async (_tx: unknown, _type: unknown, sourceId: string) => {
        record(`cashBank.clear:${sourceId}`);
      },
      replaceCashBankSourceMovements: async (_tx: unknown, _type: unknown, sourceId: string) => {
        record(`cashBank.replace:${sourceId}`);
      },
      isCashBankPostingError: () => false,
    },
  });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      rebuildExpenseProfitFacts: async (_tx: unknown, expenseId: string) => {
        record(`profitFacts.rebuild:${expenseId}`);
      },
    },
  });
  await mock.module("@/lib/wht-certificate", {
    namedExports: {
      cancelWhtCertificateForSource: async () => {
        record("wht.cancel");
      },
      persistWhtCertificate: async () => {
        record("wht.persist");
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        expense: {
          findUnique: async () =>
            preReadStatus === null
              ? null
              : {
                  id: "exp1",
                  expenseNo: "EX26090001",
                  status: preReadStatus,
                  supplier: null,
                  cashBankAccount: null,
                  items: [],
                },
        },
        documentPayment: { findMany: async () => [] },
        // Read by the pre-transaction fast path (checkDocumentMutation uses `db`).
        deliveryCommissionRun: { findMany: async () => preReadRuns },
        marketplaceSettlement: { findMany: async () => [] },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => {
        dbTxCalls += 1;
        return fn(fakeTx);
      },
    },
  });
  actions = await import("../actions");
});

beforeEach(() => {
  preReadStatus = "ACTIVE";
  statusInTx = "ACTIVE";
  preReadRuns = [];
  txRuns = [];
  txSettlements = [];
  callLog = [];
  auditWrites = 0;
  consoleErrors = 0;
  dbTxCalls = 0;
});

const cancelForm = () => {
  const form = new FormData();
  form.set("expenseId", "exp1");
  return form;
};

const updateForm = () => {
  const form = new FormData();
  form.set("expenseDate", "2026-09-15");
  form.set("supplierId", "sup-1");
  form.set("items", JSON.stringify([{ expenseCodeId: "code-1", amount: 100 }]));
  form.set("payments", JSON.stringify([{ cashBankAccountId: "acc-1", amount: 100 }]));
  return form;
};

const LOCK_AND_GUARD = [
  "lock:Expense:exp1",
  "guard:MarketplaceSettlement",
  "guard:DeliveryCommissionRun",
];

const RUN_BLOCK_MESSAGE = `ไม่สามารถดำเนินการได้ เนื่องจาก${DELIVERY_COMMISSION_EXPENSE_REASON}: DCP26090001`;

test("cancel locks the Expense row and re-runs the guard before any write", async () => {
  const result = await actions.cancelExpense(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [
    ...LOCK_AND_GUARD,
    "cashBank.clear:exp1",
    "documentPayment.deleteMany",
    "expense.update:CANCELLED",
    "wht.cancel",
    "profitFacts.rebuild:exp1",
  ]);
  assert.equal(auditWrites, 1);
});

test("update locks the Expense row and re-runs the guard before any write", async () => {
  const result = await actions.updateExpense("exp1", updateForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog.slice(0, LOCK_AND_GUARD.length + 1), [
    ...LOCK_AND_GUARD,
    "expenseItem.deleteMany",
  ]);
  assert.ok(callLog.includes("cashBank.replace:exp1"));
});

test("the lock is a parameterized SELECT ... FOR UPDATE on the expense id", async () => {
  let captured: { sql: string; values: unknown[] } | null = null;
  const original = fakeTx.$queryRaw as FakeFn;
  fakeTx.$queryRaw = async (query: unknown) => {
    captured = query as { sql: string; values: unknown[] };
    return original(query);
  };
  try {
    await actions.cancelExpense(cancelForm());
  } finally {
    fakeTx.$queryRaw = original;
  }
  assert.ok(captured);
  const { sql, values } = captured as { sql: string; values: unknown[] };
  assert.match(sql, /SELECT "status"::text AS "status"\s+FROM "Expense"\s+WHERE id = \?\s+FOR UPDATE/);
  assert.deepEqual(values, ["exp1"]);
});

test("the expense flows lock only the Expense row, never the run or settlement", async () => {
  await actions.cancelExpense(cancelForm());
  await actions.updateExpense("exp1", updateForm());
  const locks = callLog.filter((entry) => entry.startsWith("lock:") || entry.startsWith("query:"));
  assert.deepEqual(locks, ["lock:Expense:exp1", "lock:Expense:exp1"]);
});

test("update after a concurrent cancel committed sees CANCELLED and writes nothing", async () => {
  // The update's pre-check read ACTIVE; the cancel committed before its transaction.
  statusInTx = "CANCELLED";
  const result = await actions.updateExpense("exp1", updateForm());
  assert.deepEqual(result, { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" });
  assert.deepEqual(callLog, ["lock:Expense:exp1"]);
  assert.equal(auditWrites, 0);
  assert.equal(consoleErrors, 0);
});

test("a second cancel that passed the stale pre-check sees CANCELLED and writes nothing", async () => {
  const first = await actions.cancelExpense(cancelForm());
  assert.deepEqual(first, { success: true });
  assert.equal(statusInTx, "CANCELLED");

  callLog = [];
  auditWrites = 0;
  const second = await actions.cancelExpense(cancelForm());
  assert.deepEqual(second, { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(callLog, ["lock:Expense:exp1"]);
  assert.equal(auditWrites, 0);
  assert.equal(consoleErrors, 0);
});

test("an expense missing under the lock returns the not-found message and writes nothing", async () => {
  statusInTx = null;
  assert.deepEqual(await actions.cancelExpense(cancelForm()), { error: "ไม่พบเอกสาร" });
  assert.deepEqual(await actions.updateExpense("exp1", updateForm()), { error: "ไม่พบเอกสาร" });
  assert.deepEqual(callLog, ["lock:Expense:exp1", "lock:Expense:exp1"]);
  assert.equal(consoleErrors, 0);
});

test("an ACTIVE delivery commission run seen only inside the transaction blocks cancel with the guard message", async () => {
  // The pre-check saw no run; the run became visible before the lock was granted.
  txRuns = [{ id: "run-1", runNo: "DCP26090001" }];
  const result = await actions.cancelExpense(cancelForm());
  assert.deepEqual(result, { error: RUN_BLOCK_MESSAGE });
  assert.deepEqual(callLog, LOCK_AND_GUARD);
  assert.equal(auditWrites, 0);
  assert.equal(consoleErrors, 0);
});

test("an ACTIVE delivery commission run seen only inside the transaction blocks update with the guard message", async () => {
  txRuns = [{ id: "run-1", runNo: "DCP26090001" }];
  const result = await actions.updateExpense("exp1", updateForm());
  assert.deepEqual(result, { error: RUN_BLOCK_MESSAGE });
  assert.deepEqual(callLog, LOCK_AND_GUARD);
  assert.equal(auditWrites, 0);
  assert.equal(consoleErrors, 0);
});

test("an ACTIVE marketplace settlement is re-checked inside the transaction with the same message", async () => {
  txSettlements = [{ id: "set-1", settlementNo: "MS26090001" }];
  const result = await actions.cancelExpense(cancelForm());
  assert.deepEqual(result, {
    error: `ไม่สามารถดำเนินการได้ เนื่องจาก${MARKETPLACE_SETTLEMENT_SOURCE_REASON}: MS26090001`,
  });
  assert.deepEqual(callLog, LOCK_AND_GUARD);
});

test("the fast path still rejects a run-linked expense without opening a transaction", async () => {
  preReadRuns = [{ id: "run-1", runNo: "DCP26090001" }];
  assert.deepEqual(await actions.cancelExpense(cancelForm()), { error: RUN_BLOCK_MESSAGE });
  assert.deepEqual(await actions.updateExpense("exp1", updateForm()), { error: RUN_BLOCK_MESSAGE });
  assert.equal(dbTxCalls, 0);
  assert.deepEqual(callLog, []);
});

test("the fast path still rejects an already-cancelled expense without opening a transaction", async () => {
  preReadStatus = "CANCELLED";
  assert.deepEqual(await actions.cancelExpense(cancelForm()), { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(await actions.updateExpense("exp1", updateForm()), {
    error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้",
  });
  assert.equal(dbTxCalls, 0);
});

test("an unexpected error inside the transaction is logged and returns the generic message", async () => {
  const original = (fakeTx.documentPayment as Record<string, FakeFn>).deleteMany;
  (fakeTx.documentPayment as Record<string, FakeFn>).deleteMany = async () => {
    throw new Error("connection reset");
  };
  try {
    const result = await actions.cancelExpense(cancelForm());
    assert.deepEqual(result, { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
    assert.equal(consoleErrors, 1);
  } finally {
    (fakeTx.documentPayment as Record<string, FakeFn>).deleteMany = original;
  }
});
