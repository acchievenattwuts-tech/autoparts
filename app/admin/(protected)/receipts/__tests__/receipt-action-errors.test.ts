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
// Status the Receipt row has when the transaction locks it (null = row missing).
let receiptStatusInTx: string | null = "ACTIVE";
// Every data write a receipt flow can make (receipt.update is also traced in callLog).
let writeLog: string[] = [];
let reportedErrors = 0;

const recordLockQuery = async (query: unknown) => {
  const { sql, values } = query as { sql: string; values: unknown[] };
  const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
  if (table === "Receipt" && /FOR UPDATE/.test(sql)) {
    callLog.push(`lock:Receipt:${values.join(",")}`);
    return receiptStatusInTx === null ? [] : [{ status: receiptStatusInTx }];
  }
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
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async () => {
        reportedErrors += 1;
      },
    },
  });
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
      recalculateSaleAmountRemain: async (_tx: unknown, id: string) => {
        writeLog.push(`recalc:Sale:${id}`);
      },
      recalculateCNAmountRemain: async (_tx: unknown, id: string) => {
        writeLog.push(`recalc:CreditNote:${id}`);
      },
      recalculateCustomerAdvanceAmountRemain: async (_tx: unknown, id: string) => {
        writeLog.push(`recalc:CustomerAdvance:${id}`);
      },
    },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async () => {
        writeLog.push("cashBank.clear");
      },
      replaceCashBankSourceMovements: async () => {
        writeLog.push("cashBank.replace");
      },
    },
  });
  await mock.module("@/lib/wht-received", {
    namedExports: {
      cancelWhtReceivedForDocument: async () => {
        writeLog.push("wht.cancel");
      },
      persistWhtReceived: async () => {
        writeLog.push("wht.persist");
      },
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
    update: async (args: unknown) => {
      callLog.push("receipt.update");
      writeLog.push("receipt.update");
      const { data } = args as { data: { status?: string } };
      if (data.status) receiptStatusInTx = data.status;
      return {};
    },
  },
  receiptItem: {
    // Current lines of the locked receipt, read inside the transaction.
    findMany: async () => (existingReceipt as { items?: unknown[] } | null)?.items ?? [],
    createMany: async () => {
      writeLog.push("receiptItem.createMany");
      return { count: 1 };
    },
    deleteMany: async () => {
      writeLog.push("receiptItem.deleteMany");
      return { count: 1 };
    },
  },
  documentPayment: {
    deleteMany: async () => {
      writeLog.push("documentPayment.deleteMany");
      return { count: 0 };
    },
    createMany: async () => {
      writeLog.push("documentPayment.createMany");
      return { count: 1 };
    },
  },
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
  receiptStatusInTx = "ACTIVE";
  writeLog = [];
  reportedErrors = 0;
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
  assert.deepEqual(callLog.slice(0, 5), [
    "lock:Receipt:rec1",
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
  assert.deepEqual(callLog, ["lock:Receipt:rec1", ...EXPECTED_MIXED_LOCKS, "receipt.update"]);
});

// Receipt row lock — the pre-transaction status read is only a fast path. The
// Receipt row is locked FIRST inside the transaction (before CreditNote → Sale →
// CustomerAdvance) and its status re-read, so a second cancel/update that passed
// the stale pre-check stops before touching AR, cash or the receipt.
const activeMixedReceipt = () => ({
  id: "rec1",
  receiptNo: "REC26090001",
  status: "ACTIVE",
  signerName: "Staff",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Staff", signatureUrl: null },
  items: mixedItems.map((item) => ({
    saleId: item.saleId ?? null,
    cnId: item.cnId ?? null,
    customerAdvanceId: item.customerAdvanceId ?? null,
  })),
});

const cancelForm = () => {
  const form = new FormData();
  form.set("receiptId", "rec1");
  return form;
};

test("cancelReceipt locks the Receipt row before any settlement document", async () => {
  existingReceipt = activeMixedReceipt();
  const result = await actions.cancelReceipt(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.equal(callLog[0], "lock:Receipt:rec1");
  assert.deepEqual(callLog.slice(1, 4), EXPECTED_MIXED_LOCKS);
});

test("a second cancel that passed the stale pre-check sees CANCELLED and makes no writes", async () => {
  // Both requests read ACTIVE before their transactions (existingReceipt stays ACTIVE).
  existingReceipt = activeMixedReceipt();
  const first = await actions.cancelReceipt(cancelForm());
  assert.deepEqual(first, { success: true });
  assert.equal(receiptStatusInTx, "CANCELLED");

  callLog = [];
  writeLog = [];
  const second = await actions.cancelReceipt(cancelForm());
  assert.deepEqual(second, { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(callLog, ["lock:Receipt:rec1"]);
  assert.deepEqual(writeLog, []);
  assert.equal(reportedErrors, 0);
});

test("updateReceipt after a concurrent cancel sees CANCELLED and makes no writes", async () => {
  existingReceipt = activeMixedReceipt();
  receiptStatusInTx = "CANCELLED";
  const result = await actions.updateReceipt("rec1", mixedReceiptForm());
  assert.deepEqual(result, { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" });
  assert.deepEqual(callLog, ["lock:Receipt:rec1"]);
  assert.deepEqual(writeLog, []);
  assert.equal(reportedErrors, 0);
});

test("cancelReceipt reports not-found when the Receipt row is missing under the lock", async () => {
  existingReceipt = activeMixedReceipt();
  receiptStatusInTx = null;
  const result = await actions.cancelReceipt(cancelForm());
  assert.deepEqual(result, { error: "ไม่พบเอกสาร" });
  assert.deepEqual(writeLog, []);
});

test("cancelReceipt reverses AR for the lines read under the lock", async () => {
  existingReceipt = activeMixedReceipt();
  const result = await actions.cancelReceipt(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(writeLog, [
    "cashBank.clear",
    "documentPayment.deleteMany",
    "receipt.update",
    "wht.cancel",
    "recalc:Sale:sale-b",
    "recalc:Sale:sale-a",
    "recalc:CreditNote:cn-z",
    "recalc:CreditNote:cn-y",
    "recalc:CustomerAdvance:adv-2",
    "recalc:CustomerAdvance:adv-1",
  ]);
});
