import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// Server-action error handling for cash/bank documents: user-fixable posting rules
// reach the user, DB errors do not, and a doc-number collision is retried.

type FakeTx = Record<string, Record<string, (...args: unknown[]) => unknown> | ((...args: unknown[]) => unknown)>;

let fakeTx: FakeTx = {};
let generatedNumbers: string[] = [];
let permissionError: Error | null = null;
let guardBlockMessage: string | null = null;
const guardCalls: unknown[][] = [];

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
    namedExports: {
      requirePermission: async () => {
        if (permissionError) throw permissionError;
        return { user: { id: "user-1" } };
      },
    },
  });
  await mock.module("@/lib/document-mutation-guard", {
    namedExports: {
      getDocumentMutationBlockMessage: async (...args: unknown[]) => {
        guardCalls.push(args);
        return guardBlockMessage;
      },
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateCashBankTransferNo: async () => {
        const next = `TR2609${String(generatedNumbers.length + 1).padStart(4, "0")}`;
        generatedNumbers.push(next);
        return next;
      },
      generateCashBankAdjustmentNo: async () => {
        const next = `CA2609${String(generatedNumbers.length + 1).padStart(4, "0")}`;
        generatedNumbers.push(next);
        return next;
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        cashBankAccount: { findUnique: async () => null },
        cashBankTransfer: { findUnique: async () => null },
        cashBankAdjustment: { findUnique: async () => null },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  actions = await import("../actions");
});

const OPENING_DATE = new Date("2026-09-10T00:00:00+07:00");

const postingTx = (overrides: Partial<FakeTx> = {}): FakeTx => ({
  cashBankMovement: {
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 2 }),
    findFirst: async () => null,
  },
  cashBankAccount: {
    findMany: async () => [
      { id: "acc-from", code: "BANK-1", name: "กสิกร", isActive: true, openingDate: OPENING_DATE },
      { id: "acc-to", code: "CASH-1", name: "เงินสด", isActive: true, openingDate: OPENING_DATE },
    ],
    findUnique: async () => ({ openingBalance: new Prisma.Decimal(0) }),
    findFirst: async () => null,
  },
  $executeRaw: async () => 0,
  ...overrides,
});

const transferForm = (transferDate: string) => {
  const form = new FormData();
  form.set("transferDate", transferDate);
  form.set("fromAccountId", "acc-from");
  form.set("toAccountId", "acc-to");
  form.set("amount", "500");
  return form;
};

const accountForm = (overrides: Record<string, string> = {}) => {
  const form = new FormData();
  const values: Record<string, string> = {
    code: "CASH-2",
    name: "เงินสดสาขา",
    type: "CASH",
    openingBalance: "0",
    openingDate: "2026-09-01",
    isActive: "true",
    lowBalanceThreshold: "0",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
};

beforeEach(() => {
  generatedNumbers = [];
  permissionError = null;
  guardBlockMessage = null;
  guardCalls.length = 0;
  fakeTx = postingTx();
});

test("transfer dated before the account opening date shows the Thai posting rule, not the generic error", async () => {
  fakeTx = postingTx({
    cashBankTransfer: { create: async () => ({ id: "tr-1" }) },
  });
  const result = await actions.createCashBankTransfer(transferForm("2026-09-01"));
  assert.deepEqual(result, { error: "วันที่รายการของบัญชี BANK-1 - กสิกร ต้องไม่ก่อนวันที่ยอดยกมา" });
});

test("transfer retries with a fresh number when a concurrent save took the transferNo", async () => {
  const createdWith: string[] = [];
  fakeTx = postingTx({
    cashBankTransfer: {
      create: async (args: unknown) => {
        const { data } = args as { data: { transferNo: string } };
        createdWith.push(data.transferNo);
        if (createdWith.length === 1) throw uniqueViolation(['"transferNo"']);
        return { id: "tr-2" };
      },
    },
  });
  const result = await actions.createCashBankTransfer(transferForm("2026-09-15"));
  assert.deepEqual(result, { success: true });
  assert.deepEqual(createdWith, ["TR26090001", "TR26090002"]);
});

test("adjustment DB failures keep the generic message", async () => {
  fakeTx = postingTx({
    cashBankAdjustment: {
      create: async () => {
        throw new Prisma.PrismaClientUnknownRequestError("canceling statement due to lock timeout", { clientVersion: "test" });
      },
    },
  });
  const form = new FormData();
  form.set("adjustDate", "2026-09-15");
  form.set("accountId", "acc-from");
  form.set("direction", "IN");
  form.set("amount", "10");
  form.set("reason", "ปรับยอด");
  const result = await actions.createCashBankAdjustment(form);
  assert.deepEqual(result, { error: "ไม่สามารถบันทึกการปรับยอดได้" });
});

test("account create: duplicate code gets a Thai message instead of the raw Prisma text", async () => {
  fakeTx = postingTx({
    cashBankAccount: {
      findFirst: async () => null,
      create: async () => {
        throw uniqueViolation(['"code"']);
      },
    },
  });
  const result = await actions.createCashBankAccount(accountForm());
  assert.deepEqual(result, { error: "รหัสบัญชีนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น" });
});

test("account create: other DB errors fall back to the generic message", async () => {
  fakeTx = postingTx({
    cashBankAccount: {
      findFirst: async () => null,
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError("numeric field overflow on CashBankAccount.openingBalance", {
          code: "P2020",
          clientVersion: "test",
        });
      },
    },
  });
  const result = await actions.createCashBankAccount(accountForm());
  assert.deepEqual(result, { error: "ไม่สามารถสร้างบัญชีเงินได้" });
});

test("account create: primary-transfer rule messages still reach the user", async () => {
  fakeTx = postingTx({ cashBankAccount: { findFirst: async () => null } });
  const result = await actions.createCashBankAccount(accountForm({ isPrimaryTransferAccount: "true" }));
  assert.deepEqual(result, { error: "บัญชีหลักรับโอนต้องเป็นบัญชีประเภทธนาคาร" });
});

test("account update: a missing permission shows a Thai message instead of FORBIDDEN", async () => {
  permissionError = new Error("FORBIDDEN");
  const result = await actions.updateCashBankAccount("acc-1", accountForm());
  assert.deepEqual(result, { error: "ไม่มีสิทธิ์เข้าถึง" });
});

const adjustmentForm = () => {
  const form = new FormData();
  form.set("adjustDate", "2026-09-15");
  form.set("accountId", "acc-from");
  form.set("direction", "IN");
  form.set("amount", "10");
  form.set("reason", "ปรับยอด");
  return form;
};

test("adjustment update is refused before any write when a marketplace settlement created it", async () => {
  guardBlockMessage =
    "ไม่สามารถดำเนินการได้ เนื่องจากถูกสร้างจากรอบรับเงินช่องทางขาย กรุณายกเลิกที่รอบรับเงินแทน: SPS26090009";
  let transactionOpened = false;
  fakeTx = postingTx({
    cashBankAdjustment: {
      findUnique: async () => {
        transactionOpened = true;
        return { id: "adj-9", status: "ACTIVE", adjustNo: "CA26090009" };
      },
      update: async () => {
        throw new Error("must not update");
      },
    },
  });
  const result = await actions.updateCashBankAdjustment("adj-9", adjustmentForm());
  assert.deepEqual(result, { error: guardBlockMessage });
  assert.deepEqual(guardCalls, [["CashBankAdjustment", "adj-9", "update"]]);
  assert.equal(transactionOpened, false);
});

test("a manually created adjustment still updates normally", async () => {
  let updated = false;
  fakeTx = postingTx({
    cashBankAdjustment: {
      findUnique: async () => ({ id: "adj-1", status: "ACTIVE", adjustNo: "CA26090001" }),
      update: async () => {
        updated = true;
        return { id: "adj-1" };
      },
    },
  });
  const result = await actions.updateCashBankAdjustment("adj-1", adjustmentForm());
  assert.deepEqual(result, { success: true });
  assert.equal(updated, true);
  assert.deepEqual(guardCalls, [["CashBankAdjustment", "adj-1", "update"]]);
});
