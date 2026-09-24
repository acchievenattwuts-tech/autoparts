import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// createExpense / updateExpense: malformed dates return a Thai error instead of
// throwing, cash/bank posting rules reach the user, and an expenseNo collision is retried.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

class FakeCashBankPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashBankPostingError";
  }
}

let fakeTx: FakeTx = {};
let generatedNumbers: string[] = [];
let postingError: Error | null = null;

const uniqueViolation = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { fields } } } },
  });

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  mock.method(console, "error", () => undefined);
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
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
  await mock.module("@/lib/document-mutation-guard", {
    namedExports: {
      getDocumentMutationBlockMessage: async () => null,
      createDocumentMutationGuard: () => ({
        check: async () => ({ blocked: false, reason: null, references: [] }),
      }),
      buildMutationBlockMessage: () => null,
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateExpenseNo: async (date: Date) => {
        // The real generator throws RangeError on an Invalid Date.
        if (Number.isNaN(date.getTime())) throw new RangeError("Invalid time value");
        const next = `EX2609${String(generatedNumbers.length + 1).padStart(4, "0")}`;
        generatedNumbers.push(next);
        return next;
      },
    },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async () => {
        if (postingError) throw postingError;
      },
      isCashBankPostingError: (error: unknown) => error instanceof Error && error.name === "CashBankPostingError",
    },
  });
  await mock.module("@/lib/profit-cache", { namedExports: { revalidateProfitDashboardCache: () => undefined } });
  await mock.module("@/lib/profit-fact", { namedExports: { rebuildExpenseProfitFacts: async () => undefined } });
  await mock.module("@/lib/wht-certificate", {
    namedExports: {
      cancelWhtCertificateForSource: async () => undefined,
      persistWhtCertificate: async () => undefined,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        expense: {
          findUnique: async () => ({
            id: "exp1",
            expenseNo: "EX26090001",
            status: "ACTIVE",
            supplier: null,
            cashBankAccount: null,
            items: [],
          }),
        },
        documentPayment: { findMany: async () => [] },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  actions = await import("../actions");
});

const baseTx = (expenseCreate: (args: unknown) => unknown = async () => ({ id: "exp-1" })): FakeTx => ({
  // Row lock taken first by updateExpense / cancelExpense (see expense-row-lock.test.ts).
  $queryRaw: async () => [{ status: "ACTIVE" }],
  expense: { create: expenseCreate, update: async () => ({}) },
  expenseItem: { deleteMany: async () => ({ count: 1 }), createMany: async () => ({ count: 1 }) },
  documentPayment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) },
});

const expenseForm = (expenseDate: string) => {
  const form = new FormData();
  form.set("expenseDate", expenseDate);
  form.set("supplierId", "sup-1");
  form.set("items", JSON.stringify([{ expenseCodeId: "code-1", amount: 100 }]));
  form.set("payments", JSON.stringify([{ cashBankAccountId: "acc-1", amount: 100 }]));
  return form;
};

beforeEach(() => {
  generatedNumbers = [];
  postingError = null;
  fakeTx = baseTx();
});

test("createExpense returns a Thai error for a malformed date instead of throwing", async () => {
  const result = await actions.createExpense(expenseForm("15/09/2026"));
  assert.deepEqual(result, { error: "วันที่ไม่ถูกต้อง" });
  assert.equal(generatedNumbers.length, 0);
});

test("updateExpense rejects a malformed date before writing", async () => {
  const result = await actions.updateExpense("exp1", expenseForm("not-a-date"));
  assert.deepEqual(result, { error: "วันที่ไม่ถูกต้อง" });
});

test("createExpense retries with a fresh expenseNo after a collision", async () => {
  const createdWith: string[] = [];
  fakeTx = baseTx(async (args) => {
    const { data } = args as { data: { expenseNo: string } };
    createdWith.push(data.expenseNo);
    if (createdWith.length === 1) throw uniqueViolation(['"expenseNo"']);
    return { id: "exp-2" };
  });
  const result = await actions.createExpense(expenseForm("2026-09-15"));
  assert.deepEqual(result, { success: true, expenseNo: "EX26090002", expenseId: "exp-2" });
  assert.deepEqual(createdWith, ["EX26090001", "EX26090002"]);
});

test("createExpense / updateExpense show the cash/bank posting rule message", async () => {
  postingError = new FakeCashBankPostingError("วันที่รายการของบัญชี CASH-1 - เงินสด ต้องไม่ก่อนวันที่ยอดยกมา");
  assert.deepEqual(await actions.createExpense(expenseForm("2026-09-15")), {
    error: "วันที่รายการของบัญชี CASH-1 - เงินสด ต้องไม่ก่อนวันที่ยอดยกมา",
  });
  assert.deepEqual(await actions.updateExpense("exp1", expenseForm("2026-09-15")), {
    error: "วันที่รายการของบัญชี CASH-1 - เงินสด ต้องไม่ก่อนวันที่ยอดยกมา",
  });
});

test("other failures keep the generic message", async () => {
  postingError = new Error("relation \"CashBankMovement\" does not exist");
  assert.deepEqual(await actions.createExpense(expenseForm("2026-09-15")), {
    error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
  });
});
