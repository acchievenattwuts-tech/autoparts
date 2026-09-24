import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// createShopeeFeeExpense: the draft check before the transaction is only a fast
// path. Inside the transaction the order import is serialized with a
// transaction-scoped advisory lock and its linked expense re-read, so a second
// request that passed the stale draft check reuses the expense the first one
// created instead of creating a duplicate and relinking the order to it.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;
type LinkedExpense = { id: string; expenseNo: string; status: string } | null;

const ORDER_ID = "imp-1";
const RAW_PAYLOAD = {
  order_sn: "250101ABC",
  escrow_detail: { commission_fee: -12.5, service_fee: 3.25 },
};

// Linked expense seen by the pre-transaction draft read.
let draftLinkedExpense: LinkedExpense;
// Linked expense seen inside the transaction after the lock.
let txLinkedExpense: LinkedExpense;
let callLog: string[] = [];
let consoleErrors = 0;
let createdCount = 0;

const record = (entry: string) => {
  callLog.push(entry);
};

const fakeTx: FakeTx = {
  $executeRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    record(`${/pg_advisory_xact_lock/.test(sql) ? "advisoryLock" : "exec"}:${values.join(",")}`);
    return 1;
  },
  shopeeOrderImport: {
    findUnique: async () => {
      record("tx.shopeeOrderImport.findUnique");
      return { escrowExpense: txLinkedExpense ? { ...txLinkedExpense } : null };
    },
    update: async (args: unknown) => {
      const { data } = args as { data: { escrowExpenseId?: string } };
      record(`tx.shopeeOrderImport.update:${data.escrowExpenseId}`);
      return {};
    },
  },
  expense: {
    create: async (args: unknown) => {
      const { data } = args as { data: { totalAmount: { toString(): string } } };
      createdCount += 1;
      record(`tx.expense.create:${data.totalAmount.toString()}`);
      return { id: `exp-${createdCount}` };
    },
  },
};

type Escrow = typeof import("../services/escrow");
let escrow: Escrow;

before(async () => {
  await mock.module("@/lib/doc-number", {
    namedExports: { generateExpenseNo: async () => "OE26090007" },
  });
  await mock.module("@/lib/marketplace/queries", {
    namedExports: { getMarketplaceHoldingAccountId: async () => "acc-hold" },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      replaceCashBankSourceMovements: async (_tx: unknown, _type: unknown, sourceId: string) => {
        record(`cashBank.replace:${sourceId}`);
      },
    },
  });
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      rebuildExpenseProfitFacts: async (_tx: unknown, expenseId: string) => {
        record(`profitFacts.rebuild:${expenseId}`);
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        shopeeOrderImport: {
          findUnique: async () => ({
            id: ORDER_ID,
            orderSn: "250101ABC",
            saleId: "sale-1",
            rawPayload: RAW_PAYLOAD,
            escrowLastError: null,
            escrowExpense: draftLinkedExpense ? { ...draftLinkedExpense } : null,
          }),
          update: async () => {
            record("db.shopeeOrderImport.update");
            return {};
          },
        },
        // Fee ExpenseCodes are read before the transaction (lib/auto-expense-code.ts); both exist.
        expenseCode: {
          findMany: async () => [
            { id: "code-c", name: "Shopee commission fee" },
            { id: "code-s", name: "Shopee service fee" },
          ],
        },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  mock.method(console, "error", () => {
    consoleErrors += 1;
  });
  escrow = await import("../services/escrow");
});

beforeEach(() => {
  draftLinkedExpense = null;
  txLinkedExpense = null;
  callLog = [];
  consoleErrors = 0;
  createdCount = 0;
});

test("creation takes the per-order advisory lock and re-reads the link before any write", async () => {
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });
  assert.deepEqual(result, { ok: true, expenseId: "exp-1", expenseNo: "OE26090007", reused: false });
  assert.deepEqual(callLog, [
    `advisoryLock:shopee-fee-expense:${ORDER_ID}`,
    "tx.shopeeOrderImport.findUnique",
    "tx.expense.create:15.75",
    "cashBank.replace:exp-1",
    "profitFacts.rebuild:exp-1",
    "tx.shopeeOrderImport.update:exp-1",
  ]);
});

test("the lock is a parameterized pg_advisory_xact_lock(hashtext(...)) on the order import id", async () => {
  let captured: { sql: string; values: unknown[] } | null = null;
  const original = fakeTx.$executeRaw as FakeFn;
  fakeTx.$executeRaw = async (query: unknown) => {
    captured = query as { sql: string; values: unknown[] };
    return original(query);
  };
  try {
    await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });
  } finally {
    fakeTx.$executeRaw = original;
  }
  assert.ok(captured);
  const { sql, values } = captured as { sql: string; values: unknown[] };
  assert.match(sql, /SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
  assert.deepEqual(values, [`shopee-fee-expense:${ORDER_ID}`]);
});

test("a request that passed the stale draft check reuses the expense created meanwhile", async () => {
  // Draft read saw no expense; a concurrent request committed one before our lock was granted.
  txLinkedExpense = { id: "exp-first", expenseNo: "OE26090006", status: "ACTIVE" };
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });
  assert.deepEqual(result, { ok: true, expenseId: "exp-first", expenseNo: "OE26090006", reused: true });
  assert.deepEqual(callLog, [
    `advisoryLock:shopee-fee-expense:${ORDER_ID}`,
    "tx.shopeeOrderImport.findUnique",
  ]);
  assert.equal(createdCount, 0);
  assert.equal(consoleErrors, 0);
});

test("a CANCELLED linked expense seen under the lock still allows a new one", async () => {
  txLinkedExpense = { id: "exp-old", expenseNo: "OE26080001", status: "CANCELLED" };
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });
  assert.deepEqual(result, { ok: true, expenseId: "exp-1", expenseNo: "OE26090007", reused: false });
  assert.equal(createdCount, 1);
});

test("the fast path still reuses an ACTIVE expense without opening a transaction", async () => {
  draftLinkedExpense = { id: "exp-first", expenseNo: "OE26090006", status: "ACTIVE" };
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });
  assert.deepEqual(result, { ok: true, expenseId: "exp-first", expenseNo: "OE26090006", reused: true });
  assert.deepEqual(callLog, []);
});
