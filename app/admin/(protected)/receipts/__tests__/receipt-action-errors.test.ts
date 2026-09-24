import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";

// createReceipt / updateReceipt: Thai business-rule messages still reach the user,
// Prisma/DB error text does not, and a receiptNo collision is retried.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

let fakeTx: FakeTx = {};
let generatedNumbers: string[] = [];
let validationMessage: string | null = null;
// Ordered trace of row locks, the outstanding-balance read, and receipt writes.
let callLog: string[] = [];
let existingReceipt: unknown = null;

const recordLockQuery = async (query: unknown) => {
  const { sql, values } = query as { sql: string; values: unknown[] };
  const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
  const isSortedRowLock = /ORDER BY id\s+FOR UPDATE/.test(sql);
  callLog.push(`${isSortedRowLock ? "lock" : "query"}:${table}:${values.join(",")}`);
  return [];
};

const uniqueViolation = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Invalid `prisma.receipt.create()` invocation: Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { fields } } } },
  });

type Actions = typeof import("../actions");
let actions: Actions;

before(async () => {
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (before: unknown, after: unknown) => ({ before, after }),
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/error-reporting", { namedExports: { reportCriticalError: async () => undefined } });
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async () => ({ user: { id: "user-1" } }),
      requireAnyPermission: async () => ({ user: { id: "user-1" } }),
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateReceiptNo: async () => {
        const next = `REC2609${String(generatedNumbers.length + 1).padStart(4, "0")}`;
        generatedNumbers.push(next);
        return next;
      },
    },
  });
  await mock.module("@/lib/amount-remain", {
    namedExports: {
      recalculateSaleAmountRemain: async () => undefined,
      recalculateCNAmountRemain: async () => undefined,
      recalculateCustomerAdvanceAmountRemain: async () => undefined,
    },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async () => undefined,
    },
  });
  await mock.module("@/lib/wht-received", {
    namedExports: {
      cancelWhtReceivedForDocument: async () => undefined,
      persistWhtReceived: async () => undefined,
      whtReceivedSnapshotSelect: { id: true },
    },
  });
  await mock.module("@/lib/ar-settlement", {
    namedExports: {
      getAvailableReceiptDocuments: async () => {
        callLog.push("available");
        return [];
      },
      validateReceiptItemsAgainstAvailable: () => validationMessage,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        receipt: { findUnique: async () => existingReceipt },
        documentPayment: { findMany: async () => [] },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  actions = await import("../actions");
});

const baseTx = (receiptCreate: (args: unknown) => unknown): FakeTx => ({
  $queryRaw: recordLockQuery,
  user: { findUnique: async () => ({ name: "Staff", signatureUrl: null }) },
  cashBankAccount: { findMany: async () => [{ type: "CASH" }] },
  receipt: {
    create: receiptCreate,
    update: async () => {
      callLog.push("receipt.update");
      return {};
    },
  },
  receiptItem: { createMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 1 }) },
  documentPayment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) },
});

const receiptForm = () => {
  const form = new FormData();
  form.set("customerId", "cust-1");
  form.set("receiptDate", "2026-09-15");
  form.set("items", JSON.stringify([{ saleId: "sale-1", paidAmount: 100 }]));
  form.set("payments", JSON.stringify([{ cashBankAccountId: "acc-1", amount: 100 }]));
  return form;
};

beforeEach(() => {
  generatedNumbers = [];
  validationMessage = null;
  callLog = [];
  existingReceipt = null;
  fakeTx = baseTx(async () => ({ id: "rec-1" }));
});

test("a receiptNo collision regenerates the number and saves the receipt", async () => {
  const createdWith: string[] = [];
  fakeTx = baseTx(async (args) => {
    const { data } = args as { data: { receiptNo: string } };
    createdWith.push(data.receiptNo);
    if (createdWith.length === 1) throw uniqueViolation(['"receiptNo"']);
    return { id: "rec-2" };
  });
  const result = await actions.createReceipt(receiptForm());
  assert.deepEqual(result, { success: true, receiptNo: "REC26090002", receiptId: "rec-2" });
  assert.deepEqual(createdWith, ["REC26090001", "REC26090002"]);
});

test("Thai validation messages thrown inside the transaction still reach the user", async () => {
  validationMessage = "ยอดรับชำระเกินยอดค้างของใบขาย SA26090001";
  const result = await actions.createReceipt(receiptForm());
  assert.deepEqual(result, { success: false, error: "ยอดรับชำระเกินยอดค้างของใบขาย SA26090001" });
});

test("Prisma error text is replaced by the generic message", async () => {
  fakeTx = baseTx(async () => {
    throw new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated on ReceiptItem_saleId_fkey", {
      code: "P2003",
      clientVersion: "test",
    });
  });
  const result = await actions.createReceipt(receiptForm());
  assert.deepEqual(result, { success: false, error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกใบเสร็จได้" });
});

test("a collision that survives every retry is not shown as raw Prisma text", async () => {
  fakeTx = baseTx(async () => {
    throw uniqueViolation(['"receiptNo"']);
  });
  const result = await actions.createReceipt(receiptForm());
  assert.deepEqual(result, { success: false, error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกใบเสร็จได้" });
  assert.equal(generatedNumbers.length, 3);
});

// #31 — sale/CN/advance rows are locked (sorted ids, CreditNote → Sale → CustomerAdvance)
// before the outstanding balance is read, so concurrent receipts cannot both
// validate against the same pre-commit amountRemain.
const EXPECTED_MIXED_LOCKS = [
  "lock:CreditNote:cn-y,cn-z",
  "lock:Sale:sale-a,sale-b",
  "lock:CustomerAdvance:adv-1,adv-2",
];

const mixedItems = [
  { saleId: "sale-b", paidAmount: 300 },
  { saleId: "sale-a", paidAmount: 200 },
  { cnId: "cn-z", paidAmount: 50 },
  { cnId: "cn-y", paidAmount: 50 },
  { customerAdvanceId: "adv-2", paidAmount: 50 },
  { customerAdvanceId: "adv-1", paidAmount: 50 },
];

const mixedReceiptForm = () => {
  const form = receiptForm();
  form.set("items", JSON.stringify(mixedItems));
  form.set("payments", JSON.stringify([{ cashBankAccountId: "acc-1", amount: 300 }]));
  return form;
};

test("createReceipt locks sale/CN/advance rows with sorted ids before reading outstanding", async () => {
  const result = await actions.createReceipt(mixedReceiptForm());
  assert.equal(result.success, true);
  assert.deepEqual(callLog, [...EXPECTED_MIXED_LOCKS, "available"]);
});

test("createReceipt issues no lock query for a document type it does not settle", async () => {
  const result = await actions.createReceipt(receiptForm());
  assert.equal(result.success, true);
  assert.deepEqual(callLog, ["lock:Sale:sale-1", "available"]);
});

test("updateReceipt locks old and new documents with sorted ids before reading outstanding", async () => {
  existingReceipt = {
    id: "rec1",
    receiptNo: "REC26090001",
    status: "ACTIVE",
    signerName: "Staff",
    signerSignatureUrl: null,
    signedAt: null,
    user: { name: "Staff", signatureUrl: null },
    items: [
      { saleId: "sale-c", cnId: null, customerAdvanceId: null },
      { saleId: null, cnId: "cn-x", customerAdvanceId: null },
    ],
  };
  const result = await actions.updateReceipt("rec1", mixedReceiptForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog.slice(0, 4), [
    "lock:CreditNote:cn-x,cn-y,cn-z",
    "lock:Sale:sale-a,sale-b,sale-c",
    "lock:CustomerAdvance:adv-1,adv-2",
    "available",
  ]);
});

test("cancelReceipt locks every settled document before cancelling the receipt", async () => {
  existingReceipt = {
    id: "rec1",
    receiptNo: "REC26090001",
    status: "ACTIVE",
    items: mixedItems.map((item) => ({
      saleId: item.saleId ?? null,
      cnId: item.cnId ?? null,
      customerAdvanceId: item.customerAdvanceId ?? null,
    })),
  };
  const form = new FormData();
  form.set("receiptId", "rec1");
  const result = await actions.cancelReceipt(form);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [...EXPECTED_MIXED_LOCKS, "receipt.update"]);
});
