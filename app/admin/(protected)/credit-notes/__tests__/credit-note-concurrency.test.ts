import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// 1. createCreditNote: the CN number and the carrier return-shipping expense number
//    are "latest + 1" read outside the transaction. A P2002 on either column re-runs
//    the WHOLE transaction with a fresh set of numbers; exhaustion returns a clear
//    Thai message instead of the duplicate marketplace-return-case message. The
//    business unique [channel, marketplaceReturnRef] is never retried.
// 2. cancelCreditNote / updateCreditNote: the pre-transaction mutation guard is only
//    a fast path. The CreditNote row is locked FIRST inside the transaction and the
//    CreditNote guard (ACTIVE receipt / settlement / carrier expense) re-run on the
//    transaction client, so a settlement or receipt that claimed the credit note in
//    the meantime blocks the mutation before any write.
//
// The real document-mutation-guard and doc-number-retry run here; only the database
// and side-effect modules are faked.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

let callLog: string[] = [];
let criticalReports = 0;
let dbTxCalls = 0;
let docNumberSeq: Record<string, number> = {};
/** Errors thrown by successive tx.creditNote.create / tx.expense.create calls, then success. */
let creditNoteCreateErrors: Error[] = [];
let expenseCreateErrors: Error[] = [];
// Credit note row the cancel/update flows work on.
let preReadStatus: string;
let statusInTx: string;
let cnChannel: string | null;
// Downstream documents visible to the pre-check (db) and inside the transaction (tx).
let preReadSettlements: { id: string; settlementNo: string }[];
let txSettlements: { id: string; settlementNo: string }[];
let txReceipts: { id: string; receiptNo: string }[];

const record = (entry: string) => {
  callLog.push(entry);
};

const nextDocNo = (prefix: string): string => {
  docNumberSeq[prefix] = (docNumberSeq[prefix] ?? 0) + 1;
  const docNo = `${prefix}2609${String(docNumberSeq[prefix]).padStart(4, "0")}`;
  record(`generate:${docNo}`);
  return docNo;
};

const settlementLineRows = (rows: { id: string; settlementNo: string }[]) =>
  rows.map((settlement) => ({ settlement }));

const fakeTx: FakeTx = {
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    return [{ status: statusInTx }];
  },
  // Guard reads (CreditNote branch of the document mutation guard).
  receiptItem: {
    findMany: async () => {
      record("guard:ReceiptItem");
      return txReceipts.map((receipt) => ({ receipt }));
    },
  },
  marketplaceSettlementLine: {
    findMany: async () => {
      record("guard:MarketplaceSettlementLine");
      return settlementLineRows(txSettlements);
    },
  },
  sale: {
    findUnique: async (args: unknown) => {
      const { select } = args as { select: Record<string, unknown> };
      if (select.items) {
        return { items: [{ id: "si-1", productId: "p-1", quantity: 2, costPrice: 50 }] };
      }
      return { id: "sale-1", status: "ACTIVE", customerId: "cust-1", saleNo: "SO26090001", channel: "SHOPEE" };
    },
  },
  saleItem: { findMany: async () => [{ id: "si-1", productId: "p-1", quantity: 2 }] },
  productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] },
  product: { findMany: async () => [{ id: "p-1", inventoryTracking: "TRACKED", isLotControl: false }] },
  cashBankAccount: {
    findMany: async () => [{ type: "BANK" }],
    findFirst: async () => ({ id: "acc-ship" }),
  },
  creditNote: {
    create: async (args: unknown) => {
      const { data } = args as { data: { cnNo: string } };
      record(`creditNote.create:${data.cnNo}`);
      const error = creditNoteCreateErrors.shift();
      if (error) throw error;
      return { id: "cn1" };
    },
    update: async (args: unknown) => {
      const { data } = args as { data: { status?: string } };
      record(data.status ? `creditNote.update:${data.status}` : "creditNote.update");
      return {};
    },
  },
  creditNoteItem: {
    groupBy: async () => [],
    create: async () => {
      record("creditNoteItem.create");
      return { id: "cni-1" };
    },
    deleteMany: async () => {
      record("creditNoteItem.deleteMany");
      return { count: 0 };
    },
  },
  documentPayment: {
    deleteMany: async () => {
      record("documentPayment.deleteMany");
      return { count: 0 };
    },
    createMany: async () => {
      record("documentPayment.createMany");
      return { count: 1 };
    },
  },
  expenseCode: { upsert: async () => ({ id: "code-ret" }) },
  expense: {
    findMany: async () => {
      record("guard:Expense");
      return [];
    },
    create: async (args: unknown) => {
      const { data } = args as { data: { expenseNo: string } };
      record(`expense.create:${data.expenseNo}`);
      const error = expenseCreateErrors.shift();
      if (error) throw error;
      return { id: "exp-1" };
    },
  },
  auditLog: { create: async () => ({}) },
  stockCard: {
    deleteMany: async () => {
      record("stockCard.deleteMany");
      return { count: 0 };
    },
  },
};

const creditNoteRow = () => ({
  id: "cn1",
  cnNo: "CN26090001",
  status: preReadStatus,
  type: "DISCOUNT",
  settlementType: "CREDIT_DEBT",
  refundMethod: null,
  channel: cnChannel,
  saleId: null,
  sale: null,
  customerId: "cust-1",
  customer: null,
  customerName: null,
  cnDate: new Date("2026-09-10T00:00:00.000Z"),
  marketplaceReturnRef: null,
  cashBankAccountId: null,
  totalAmount: 100,
  amountRemain: 100,
  subtotalAmount: 100,
  vatAmount: 0,
  vatType: "NO_VAT",
  vatRate: 0,
  note: null,
  cancelNote: null,
  cancelledAt: null,
  items: [],
});

type Actions = typeof import("../actions");
let actions: Actions;
let Prisma: typeof import("@/lib/generated/prisma").Prisma;

before(async () => {
  ({ Prisma } = await import("@/lib/generated/prisma"));
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
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async () => {
        criticalReports += 1;
      },
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateCNNo: async () => nextDocNo("CN"),
      generateExpenseNo: async () => nextDocNo("OE"),
    },
  });
  await mock.module("@/lib/stock-card", {
    namedExports: {
      writeStockCard: async () => {
        record("stockCard.write");
        return "sc-1";
      },
      recalculateStockCardMany: async () => {
        record("stockCard.recalculate");
      },
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      reverseCreditNoteLotBalance: async () => {
        record("lot.reverse");
      },
      validateLotRows: () => null,
      writeCreditNoteLots: async () => undefined,
      writeStockMovementLots: async () => undefined,
    },
  });
  await mock.module("@/lib/transaction-product-search", {
    namedExports: {
      getTransactionProductDetailRowsByIds: async () => [],
      searchTransactionProductDetailRows: async () => [],
    },
  });
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      clearCashBankSourceMovements: async (_tx: unknown, type: string) => {
        record(`cashBank.clear:${type}`);
      },
      replaceCashBankSourceMovements: async (_tx: unknown, type: string) => {
        record(`cashBank.replace:${type}`);
      },
    },
  });
  await mock.module("@/lib/amount-remain", {
    namedExports: {
      recalculateCNAmountRemain: async () => {
        record("amountRemain.recalculate");
      },
    },
  });
  await mock.module("@/lib/profit-cache", {
    namedExports: { revalidateProfitDashboardCache: () => undefined },
  });
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      rebuildCreditNoteProfitFacts: async () => {
        record("profitFacts.rebuild:CreditNote");
      },
      rebuildExpenseProfitFacts: async () => {
        record("profitFacts.rebuild:Expense");
      },
    },
  });
  await mock.module("@/lib/notifications", {
    namedExports: { notifyMarketplaceReturnRecorded: async () => undefined },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: { findUnique: async () => ({ channel: "SHOPEE", cashBankAccountId: "hold-1" }) },
        creditNote: { findUnique: async () => creditNoteRow() },
        documentPayment: { findMany: async () => [] },
        productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] },
        // Read by the pre-transaction fast path (checkDocumentMutation uses `db`).
        receiptItem: { findMany: async () => [], findFirst: async () => null },
        marketplaceSettlementLine: {
          findMany: async () => settlementLineRows(preReadSettlements),
        },
        expense: { findMany: async () => [] },
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
  callLog = [];
  criticalReports = 0;
  dbTxCalls = 0;
  docNumberSeq = {};
  creditNoteCreateErrors = [];
  expenseCreateErrors = [];
  preReadStatus = "ACTIVE";
  statusInTx = "ACTIVE";
  cnChannel = null;
  preReadSettlements = [];
  txSettlements = [];
  txReceipts = [];
});

/** Prisma 7 driver-adapter P2002 shape (no meta.target). */
const adapterP2002 = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "UniqueConstraintViolation", constraint: { fields } },
      },
    },
  });

const DOC_NUMBER_CONFLICT_MESSAGE =
  "เลขที่เอกสารชนกับรายการที่บันทึกพร้อมกัน ระบบลองออกเลขใหม่แล้วยังไม่สำเร็จ กรุณาบันทึกอีกครั้ง";
const RETURN_REF_DUPLICATE_MESSAGE = "เลขอ้างอิงเคสคืน Marketplace นี้ถูกบันทึกแล้ว กรุณาตรวจสอบรายการเดิม";

// ─── 1. createCreditNote document-number retry ────────────────────────────

const marketplaceReturnForm = (carrierAmount = 40) => {
  const form = new FormData();
  form.set("cnDate", "2026-09-10");
  form.set("customerId", "cust-1");
  form.set("saleId", "sale-1");
  form.set("type", "RETURN");
  form.set("settlementType", "CASH_REFUND");
  form.set("marketplaceReturnRef", "RET-1");
  form.set(
    "items",
    JSON.stringify([
      {
        saleItemId: "si-1",
        productId: "p-1",
        unitName: "ชิ้น",
        qty: 1,
        salePrice: 100,
        stockDisposition: "DAMAGED_NO_RESTOCK",
        stockDispositionNote: "กล่องแตก",
      },
    ]),
  );
  form.set("payments", JSON.stringify([{ cashBankAccountId: "hold-1", amount: 100 }]));
  if (carrierAmount > 0) {
    form.set(
      "carrierExpense",
      JSON.stringify({ amount: carrierAmount, expenseDate: "2026-09-10", cashBankAccountId: "acc-ship" }),
    );
  }
  return form;
};

/** Number generation and the two inserts that carry a generated number, in call order. */
const numberTrace = () =>
  callLog.filter(
    (entry) =>
      entry.startsWith("generate:") ||
      entry.startsWith("creditNote.create:") ||
      entry.startsWith("expense.create:"),
  );

test("create without a collision generates each number once and saves both documents", async () => {
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { success: true, cnNo: "CN26090001" });
  assert.deepEqual(numberTrace(), [
    "generate:CN26090001",
    "generate:OE26090001",
    "creditNote.create:CN26090001",
    "expense.create:OE26090001",
  ]);
  assert.equal(dbTxCalls, 1);
  assert.equal(criticalReports, 0);
});

test("a carrier expenseNo collision re-runs the whole transaction with a fresh number set", async () => {
  expenseCreateErrors = [adapterP2002(['"expenseNo"'])];
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.deepEqual(numberTrace(), [
    "generate:CN26090001",
    "generate:OE26090001",
    "creditNote.create:CN26090001",
    "expense.create:OE26090001",
    "generate:CN26090002",
    "generate:OE26090002",
    "creditNote.create:CN26090002",
    "expense.create:OE26090002",
  ]);
  assert.equal(dbTxCalls, 2);
  assert.equal(criticalReports, 0);
});

test("a cnNo collision is retried too (old meta.target shape)", async () => {
  creditNoteCreateErrors = [
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["cnNo"] },
    }),
  ];
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.equal(dbTxCalls, 2);
});

test("a credit note without carrier expense retries only the CN number", async () => {
  creditNoteCreateErrors = [adapterP2002(['"cnNo"'])];
  const result = await actions.createCreditNote(marketplaceReturnForm(0));
  assert.deepEqual(result, { success: true, cnNo: "CN26090002" });
  assert.deepEqual(numberTrace(), [
    "generate:CN26090001",
    "creditNote.create:CN26090001",
    "generate:CN26090002",
    "creditNote.create:CN26090002",
  ]);
});

test("exhausted number retries return the document-number message, not the duplicate-case message", async () => {
  expenseCreateErrors = [
    adapterP2002(['"expenseNo"']),
    adapterP2002(['"expenseNo"']),
    adapterP2002(['"expenseNo"']),
  ];
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { error: DOC_NUMBER_CONFLICT_MESSAGE });
  assert.equal(dbTxCalls, 3);
  assert.deepEqual(
    numberTrace().filter((entry) => entry.startsWith("expense.create:")),
    ["expense.create:OE26090001", "expense.create:OE26090002", "expense.create:OE26090003"],
  );
});

test("a duplicate marketplace return case (business unique) is not retried and keeps its message", async () => {
  creditNoteCreateErrors = [adapterP2002(['"channel"', '"marketplaceReturnRef"'])];
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { error: RETURN_REF_DUPLICATE_MESSAGE });
  assert.equal(dbTxCalls, 1);
});

test("a P2002 that names no column keeps today's duplicate-case message without retrying", async () => {
  creditNoteCreateErrors = [
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    }),
  ];
  const result = await actions.createCreditNote(marketplaceReturnForm());
  assert.deepEqual(result, { error: RETURN_REF_DUPLICATE_MESSAGE });
  assert.equal(dbTxCalls, 1);
});

// ─── 2. cancel / update: lock, then re-run the CreditNote guard ───────────

const LOCK_AND_GUARD = [
  "lock:CreditNote:cn1",
  "guard:ReceiptItem",
  "guard:MarketplaceSettlementLine",
  "guard:Expense",
];

const SETTLEMENT_BLOCK_MESSAGE =
  "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: SPS26090001";
const RECEIPT_BLOCK_MESSAGE = "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: REC26090001";

const cancelForm = () => {
  const form = new FormData();
  form.set("cnId", "cn1");
  return form;
};

const updateForm = () => {
  const form = new FormData();
  form.set("cnDate", "2026-09-10");
  form.set("customerId", "cust-1");
  form.set("type", "DISCOUNT");
  form.set("settlementType", "CREDIT_DEBT");
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 100 }]));
  return form;
};

test("cancel locks the CreditNote row and re-runs the guard before any write", async () => {
  const result = await actions.cancelCreditNote(cancelForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog, [
    ...LOCK_AND_GUARD,
    "cashBank.clear:CN_SALE",
    "documentPayment.deleteMany",
    "creditNote.update:CANCELLED",
    "profitFacts.rebuild:CreditNote",
  ]);
});

test("a settlement that claimed the credit note after the pre-check blocks cancel with the guard message", async () => {
  // Pre-check saw no settlement; createMarketplaceSettlement committed before the lock was granted.
  cnChannel = "SHOPEE";
  txSettlements = [{ id: "set-1", settlementNo: "SPS26090001" }];
  const result = await actions.cancelCreditNote(cancelForm());
  assert.deepEqual(result, { error: SETTLEMENT_BLOCK_MESSAGE });
  assert.deepEqual(callLog, LOCK_AND_GUARD, "nothing is written after the guard blocks");
  assert.equal(criticalReports, 0);
});

test("a receipt that claimed the credit note after the pre-check blocks cancel with the guard message", async () => {
  txReceipts = [{ id: "rec-1", receiptNo: "REC26090001" }];
  const result = await actions.cancelCreditNote(cancelForm());
  assert.deepEqual(result, { error: RECEIPT_BLOCK_MESSAGE });
  assert.deepEqual(callLog, LOCK_AND_GUARD);
  assert.equal(criticalReports, 0);
});

test("update locks the CreditNote row and re-runs the guard before any write", async () => {
  const result = await actions.updateCreditNote("cn1", updateForm());
  assert.deepEqual(result, { success: true });
  assert.deepEqual(callLog.slice(0, LOCK_AND_GUARD.length), LOCK_AND_GUARD);
  assert.ok(callLog.includes("creditNote.update"));
  assert.equal(criticalReports, 0);
});

test("a receipt that claimed the credit note after the pre-check blocks update with the guard message", async () => {
  txReceipts = [{ id: "rec-1", receiptNo: "REC26090001" }];
  const result = await actions.updateCreditNote("cn1", updateForm());
  assert.deepEqual(result, { error: RECEIPT_BLOCK_MESSAGE });
  assert.deepEqual(callLog, LOCK_AND_GUARD);
  assert.equal(criticalReports, 0);
});

test("a credit note cancelled concurrently still stops at the lock with the existing messages", async () => {
  statusInTx = "CANCELLED";
  assert.deepEqual(await actions.cancelCreditNote(cancelForm()), { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.deepEqual(await actions.updateCreditNote("cn1", updateForm()), {
    error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้",
  });
  assert.deepEqual(callLog, ["lock:CreditNote:cn1", "lock:CreditNote:cn1"]);
  assert.equal(criticalReports, 0);
});

test("the fast path still rejects a settled credit note without opening a transaction", async () => {
  preReadSettlements = [{ id: "set-1", settlementNo: "SPS26090001" }];
  assert.deepEqual(await actions.cancelCreditNote(cancelForm()), { error: SETTLEMENT_BLOCK_MESSAGE });
  assert.deepEqual(await actions.updateCreditNote("cn1", updateForm()), { error: SETTLEMENT_BLOCK_MESSAGE });
  assert.equal(dbTxCalls, 0);
  assert.deepEqual(callLog, []);
});
