import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// createShopeeFeeExpense: expenseNo is generated as "latest + 1" outside the
// transaction, so a concurrent expense save anywhere can take the same number and
// the insert fails with P2002 on expenseNo. The whole transaction (per-order lock,
// insert and its dependent writes) is re-run with a freshly generated number; when
// every attempt collides, a Thai message is stored and returned instead of the raw
// Prisma error.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

const ORDER_ID = "imp-1";
const RAW_PAYLOAD = {
  order_sn: "250101ABC",
  escrow_detail: { commission_fee: -12.5, service_fee: 3.25 },
};

const uniqueViolation = (column: string): Error =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${column}\`)`, {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: { target: [column] },
  });
const expenseNoCollision = (): Error => uniqueViolation("expenseNo");

let generatedNumbers: string[] = [];
let callLog: string[] = [];
let storedErrors: (string | null)[] = [];
// Each expense.create call shifts one entry: an Error to throw, or null to succeed.
let createOutcomes: (Error | null)[] = [];
let txCount = 0;
let committedWrites: string[] = [];

const record = (entry: string) => {
  callLog.push(entry);
};

const makeTx = (writes: string[]): FakeTx => ({
  $executeRaw: async (query: unknown) => {
    const { values } = query as { values: unknown[] };
    record(`advisoryLock:${values.join(",")}`);
    return 1;
  },
  shopeeOrderImport: {
    findUnique: async () => {
      record("tx.shopeeOrderImport.findUnique");
      return { escrowExpense: null };
    },
    update: async (args: unknown) => {
      const { data } = args as { data: { escrowExpenseId?: string } };
      writes.push(`link:${data.escrowExpenseId}`);
      return {};
    },
  },
  expenseCode: {
    findMany: async () => [
      { id: "code-c", code: "E0001", name: "Shopee commission fee" },
      { id: "code-s", code: "E0002", name: "Shopee service fee" },
    ],
    create: async () => ({ id: "code-new" }),
  },
  expense: {
    create: async (args: unknown) => {
      const { data } = args as { data: { expenseNo: string } };
      record(`tx.expense.create:${data.expenseNo}`);
      const outcome = createOutcomes.shift() ?? null;
      if (outcome) throw outcome;
      writes.push(`expense:${data.expenseNo}`);
      return { id: `exp-${data.expenseNo}` };
    },
  },
});

type Escrow = typeof import("../services/escrow");
let escrow: Escrow;

before(async () => {
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateExpenseNo: async () => {
        const next = `OE2609${String(generatedNumbers.length + 7).padStart(4, "0")}`;
        generatedNumbers.push(next);
        return next;
      },
    },
  });
  await mock.module("@/lib/marketplace/queries", {
    namedExports: { getMarketplaceHoldingAccountId: async () => "acc-hold" },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      replaceCashBankSourceMovements: async (_tx: unknown, _type: unknown, sourceId: string, entries: unknown) => {
        const [entry] = entries as { referenceNo: string }[];
        record(`cashBank.replace:${sourceId}:${entry?.referenceNo}`);
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
            escrowExpense: null,
          }),
          update: async (args: unknown) => {
            const { data } = args as { data: { escrowLastError: string | null } };
            storedErrors.push(data.escrowLastError);
            return {};
          },
        },
      },
      // A failed attempt rolls back: its writes are only committed when fn resolves.
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => {
        txCount += 1;
        const writes: string[] = [];
        const result = await fn(makeTx(writes));
        committedWrites.push(...writes);
        return result;
      },
    },
  });
  mock.method(console, "error", () => undefined);
  escrow = await import("../services/escrow");
});

beforeEach(() => {
  generatedNumbers = [];
  callLog = [];
  storedErrors = [];
  createOutcomes = [];
  txCount = 0;
  committedWrites = [];
});

test("a P2002 on expenseNo re-runs the whole transaction with a fresh number", async () => {
  createOutcomes = [expenseNoCollision(), null];
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });

  assert.deepEqual(result, { ok: true, expenseId: "exp-OE26090008", expenseNo: "OE26090008", reused: false });
  assert.deepEqual(generatedNumbers, ["OE26090007", "OE26090008"]);
  assert.equal(txCount, 2);
  // The per-order lock and re-read run again inside the retried transaction.
  assert.deepEqual(callLog, [
    `advisoryLock:shopee-fee-expense:${ORDER_ID}`,
    "tx.shopeeOrderImport.findUnique",
    "tx.expense.create:OE26090007",
    `advisoryLock:shopee-fee-expense:${ORDER_ID}`,
    "tx.shopeeOrderImport.findUnique",
    "tx.expense.create:OE26090008",
    "cashBank.replace:exp-OE26090008:OE26090008",
    "profitFacts.rebuild:exp-OE26090008",
  ]);
  assert.deepEqual(committedWrites, ["expense:OE26090008", "link:exp-OE26090008"]);
  assert.deepEqual(storedErrors, [], "a recovered collision stores no error");
});

test("when every attempt collides, a Thai message is stored and returned, never the raw Prisma error", async () => {
  createOutcomes = [expenseNoCollision(), expenseNoCollision(), expenseNoCollision()];
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });

  assert.deepEqual(result, { ok: false, error: escrow.SHOPEE_FEE_EXPENSE_NUMBER_CONFLICT_MESSAGE });
  assert.match(escrow.SHOPEE_FEE_EXPENSE_NUMBER_CONFLICT_MESSAGE, /[\u0E00-\u0E7F]/);
  assert.deepEqual(generatedNumbers, ["OE26090007", "OE26090008", "OE26090009"]);
  assert.equal(txCount, 3);
  assert.deepEqual(committedWrites, []);
  assert.deepEqual(storedErrors, [escrow.SHOPEE_FEE_EXPENSE_NUMBER_CONFLICT_MESSAGE]);
  assert.equal(JSON.stringify([result, storedErrors]).includes("Unique constraint"), false);
});

test("a P2002 on another column is not retried and is reported with a generic Thai message", async () => {
  createOutcomes = [uniqueViolation("code")];
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });

  assert.equal(txCount, 1);
  assert.deepEqual(generatedNumbers, ["OE26090007"]);
  assert.deepEqual(result, { ok: false, error: escrow.SHOPEE_FEE_EXPENSE_FAILED_MESSAGE });
  assert.deepEqual(storedErrors, [escrow.SHOPEE_FEE_EXPENSE_FAILED_MESSAGE]);
});

test("other database errors store a generic Thai message instead of the Prisma text", async () => {
  createOutcomes = [
    new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
      code: "P2034",
      clientVersion: "7.0.0",
    }),
  ];
  const result = await escrow.createShopeeFeeExpense({ orderImportId: ORDER_ID, userId: "user-1" });

  assert.deepEqual(result, { ok: false, error: escrow.SHOPEE_FEE_EXPENSE_FAILED_MESSAGE });
  assert.deepEqual(storedErrors, [escrow.SHOPEE_FEE_EXPENSE_FAILED_MESSAGE]);
  assert.equal(txCount, 1);
});
