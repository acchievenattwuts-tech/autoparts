import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// createMarketplaceSettlement: the selected sales / credit notes are read before
// the transaction only as a fast path. Inside the transaction, before any write,
// the CreditNote rows and then the Sale rows are locked (sorted ids) and
// re-checked with the same eligibility rules, so a document cancelled, edited, or
// claimed by another settlement in the meantime can no longer end up in this one.

type FakeFn = (...args: unknown[]) => unknown;
type FakeTx = Record<string, Record<string, FakeFn> | FakeFn>;

type DocState = { status: string; eligible: boolean; amount: number };

const SALES_PRE_READ = [
  { id: "sale-b", saleNo: "SO26090002", saleDate: new Date("2026-09-01T00:00:00Z"), netAmount: 600 },
  { id: "sale-a", saleNo: "SO26090001", saleDate: new Date("2026-09-01T00:00:00Z"), netAmount: 400 },
];
const CREDIT_NOTES_PRE_READ = [
  { id: "cn-a", cnNo: "CN26090001", cnDate: new Date("2026-09-02T00:00:00Z"), totalAmount: 100 },
];

let saleState: Record<string, DocState>;
let creditNoteState: Record<string, DocState>;
let callLog: string[] = [];
let capturedLockSql: { sql: string; values: unknown[] }[] = [];
let consoleErrors = 0;
let settlementCreateError: Error | null = null;
/** Errors thrown by successive tx.expense.create calls (one per attempt), then success. */
let expenseCreateErrors: Error[] = [];
/** Per-prefix counters so each regeneration returns a fresh number. */
let docNumberSeq: Record<string, number> = {};
// ── Auto-created master rows (read / created before the settlement transaction) ──
/** Successive db.supplier.findUnique results; the default is an existing Supplier. */
let dbSupplierReads: ({ id: string } | null)[] = [];
/** When false, db.expenseCode.findMany finds none of the requested names. */
let dbExpenseCodesExist = true;
/** Successive by-name reads inside the short ExpenseCode transaction. */
let txExpenseCodeReads: { id: string; name: string }[][] = [];
let usedFeeCodes: string[] = [];
let supplierCreateErrors: Error[] = [];
let expenseCodeCreateErrors: Error[] = [];
let lastExpenseData: unknown = null;

const nextDocNo = (prefix: string): string => {
  docNumberSeq[prefix] = (docNumberSeq[prefix] ?? 0) + 1;
  return `${prefix}2609${String(docNumberSeq[prefix]).padStart(4, "0")}`;
};

const record = (entry: string) => {
  callLog.push(entry);
};

const writeRecorder = (entry: string, result: Record<string, unknown> = { id: `${entry}-id` }) =>
  async () => {
    record(entry);
    return result;
  };

const eligibleRows = (state: Record<string, DocState>, ids: string[], amountKey: string) =>
  ids
    .filter((id) => state[id]?.status === "ACTIVE" && state[id]?.eligible)
    .map((id) => ({ id, [amountKey]: state[id].amount }));

const fakeTx: FakeTx = {
  $queryRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    capturedLockSql.push({ sql, values });
    record(`${/FOR UPDATE/.test(sql) ? "lock" : "query"}:${table}:${values.join(",")}`);
    const state = table === "Sale" ? saleState : creditNoteState;
    return (values as string[])
      .filter((id) => state[id])
      .map((id) => ({ id, status: state[id].status }));
  },
  creditNote: {
    findMany: async (args: unknown) => {
      const { where } = args as { where: { id: { in: string[] } } };
      record("creditNote.findMany");
      return eligibleRows(creditNoteState, where.id.in, "totalAmount");
    },
  },
  sale: {
    findMany: async (args: unknown) => {
      const { where } = args as { where: { id: { in: string[] } } };
      record("sale.findMany");
      return eligibleRows(saleState, where.id.in, "netAmount");
    },
  },
  cashBankAccount: { findFirst: writeRecorder("cashBankAccount.findFirst", { id: "bank-1" }) },
  // Used only by the short master-row transactions that run before the settlement one.
  $executeRaw: async (query: unknown) => {
    const { sql, values } = query as { sql: string; values: unknown[] };
    record(`${/pg_advisory_xact_lock/.test(sql) ? "advisoryLock" : "exec"}:${values.join(",")}`);
    return 1;
  },
  supplier: {
    create: async () => {
      record("tx.supplier.create");
      const error = supplierCreateErrors.shift();
      if (error) throw error;
      return { id: "sup-new" };
    },
  },
  auditLog: { create: writeRecorder("tx.auditLog.create") },
  expenseCode: {
    findMany: async (args: unknown) => {
      const { where } = args as { where: { name?: { in: string[] }; code?: { startsWith: string } } };
      if (where.name) {
        record("tx.expenseCode.findMany:name");
        return (txExpenseCodeReads.shift() ?? []).filter((row) => where.name?.in.includes(row.name));
      }
      record(`tx.expenseCode.findMany:code:${where.code?.startsWith}`);
      return usedFeeCodes.map((code) => ({ code }));
    },
    create: async (args: unknown) => {
      const { data } = args as { data: { code: string; name: string; description: string } };
      record(`tx.expenseCode.create:${data.code}:${data.name}:${data.description}`);
      const error = expenseCodeCreateErrors.shift();
      if (error) throw error;
      return { id: `new:${data.code}` };
    },
  },
  expense: {
    create: async (args: unknown) => {
      const { data } = args as { data: { expenseNo: string } };
      lastExpenseData = data;
      record(`expense.create:${data.expenseNo}`);
      const error = expenseCreateErrors.shift();
      if (error) throw error;
      return { id: "exp-1" };
    },
  },
  cashBankTransfer: { create: writeRecorder("cashBankTransfer.create", { id: "tr-1" }) },
  marketplaceSettlement: {
    create: async () => {
      record("marketplaceSettlement.create");
      if (settlementCreateError) throw settlementCreateError;
      return { id: "set-1" };
    },
  },
};

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
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async (_tx: unknown, type: string) => {
        record(`cashBank.replace:${type}`);
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
      notifyMarketplaceSettlementCancelled: async () => undefined,
      notifyMarketplaceSettlementRecorded: async () => undefined,
    },
  });
  await mock.module("@/lib/doc-number", {
    namedExports: {
      generateCashBankAdjustmentNo: async () => nextDocNo("CBA"),
      generateCashBankTransferNo: async () => nextDocNo("CBT"),
      generateExpenseNo: async () => nextDocNo("OE"),
      generateMarketplaceSettlementNo: async () => nextDocNo("SPS"),
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        marketplaceChannelSetting: {
          findFirst: async () => ({ id: "setting-1", settlementCashBankAccountId: "hold-1" }),
        },
        sale: { findMany: async () => SALES_PRE_READ.map((sale) => ({ ...sale })) },
        creditNote: { findMany: async () => CREDIT_NOTES_PRE_READ.map((cn) => ({ ...cn })) },
        supplier: {
          findUnique: async () => {
            record("db.supplier.findUnique");
            return dbSupplierReads.length > 0 ? dbSupplierReads.shift() : { id: "sup-1" };
          },
        },
        expenseCode: {
          findMany: async (args: unknown) => {
            const { where } = args as { where: { name: { in: string[] } } };
            record("db.expenseCode.findMany");
            return dbExpenseCodesExist ? where.name.in.map((name) => ({ id: `code:${name}`, name })) : [];
          },
        },
      },
      dbTx: async (fn: (tx: FakeTx) => Promise<unknown>) => fn(fakeTx),
    },
  });
  mock.method(console, "error", () => {
    consoleErrors += 1;
  });
  actions = await import("../actions");
});

const payload = () => ({
  channel: "SHOPEE",
  settlementDate: "2026-09-05",
  payoutRef: "PAYOUT-1",
  destinationAccountId: "bank-1",
  // 400 + 600 − 100 = 900: balanced, so no fee expense or income adjustment is created.
  payoutAmount: 900,
  saleIds: ["sale-b", "sale-a"],
  creditNoteIds: ["cn-a"],
  lines: [],
});

const LOCK_TRACE = [
  "lock:CreditNote:cn-a",
  "lock:Sale:sale-a,sale-b",
  "creditNote.findMany",
  "sale.findMany",
];

beforeEach(() => {
  saleState = {
    "sale-a": { status: "ACTIVE", eligible: true, amount: 400 },
    "sale-b": { status: "ACTIVE", eligible: true, amount: 600 },
  };
  creditNoteState = { "cn-a": { status: "ACTIVE", eligible: true, amount: 100 } };
  callLog = [];
  capturedLockSql = [];
  consoleErrors = 0;
  settlementCreateError = null;
  expenseCreateErrors = [];
  docNumberSeq = {};
  dbSupplierReads = [];
  dbExpenseCodesExist = true;
  txExpenseCodeReads = [];
  usedFeeCodes = [];
  supplierCreateErrors = [];
  expenseCodeCreateErrors = [];
  lastExpenseData = null;
});

test("locks CreditNote then Sale rows (sorted ids) before any write, then creates the settlement", async () => {
  const result = await actions.createMarketplaceSettlement(payload());
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090001", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    ...LOCK_TRACE,
    "cashBankAccount.findFirst",
    "cashBankTransfer.create",
    "cashBank.replace:TRANSFER",
    "marketplaceSettlement.create",
    "profitFacts.rebuild:set-1",
  ]);
});

test("the locks are parameterized SELECT ... ORDER BY id FOR UPDATE queries", async () => {
  await actions.createMarketplaceSettlement(payload());
  assert.equal(capturedLockSql.length, 2);
  const [cnLock, saleLock] = capturedLockSql;
  assert.match(cnLock.sql, /SELECT id, "status"::text AS "status"\s+FROM "CreditNote"\s+WHERE id IN \(\?\)\s+ORDER BY id\s+FOR UPDATE/);
  assert.deepEqual(cnLock.values, ["cn-a"]);
  assert.match(saleLock.sql, /SELECT id, "status"::text AS "status"\s+FROM "Sale"\s+WHERE id IN \(\?,\s*\?\)\s+ORDER BY id\s+FOR UPDATE/);
  assert.deepEqual(saleLock.values, ["sale-a", "sale-b"]);
});

test("a sale cancelled after the pre-check is rejected under the lock with its number and no writes", async () => {
  saleState["sale-a"].status = "CANCELLED";
  const result = await actions.createMarketplaceSettlement(payload());
  assert.deepEqual(result, {
    error: "มีเอกสารเปลี่ยนแปลงระหว่างบันทึกรอบรับเงิน — ถูกยกเลิกแล้ว: SO26090001 กรุณาโหลดหน้าใหม่แล้วเลือกเอกสารอีกครั้ง",
  });
  assert.deepEqual(callLog, LOCK_TRACE);
  assert.equal(consoleErrors, 0);
});

test("a credit note cancelled after the pre-check is rejected with its number", async () => {
  creditNoteState["cn-a"].status = "CANCELLED";
  const result = await actions.createMarketplaceSettlement(payload());
  assert.ok("error" in result);
  assert.match(result.error ?? "", /ถูกยกเลิกแล้ว: CN26090001/);
  assert.deepEqual(callLog, LOCK_TRACE);
});

test("a sale claimed by another settlement meanwhile is rejected as unavailable", async () => {
  saleState["sale-b"].eligible = false;
  const result = await actions.createMarketplaceSettlement(payload());
  assert.ok("error" in result);
  assert.match(result.error ?? "", /ถูกกระทบยอดในรอบอื่นแล้วหรือไม่พร้อมกระทบยอด: SO26090002/);
  assert.deepEqual(callLog, LOCK_TRACE);
});

test("a sale whose amount was edited after the pre-check is rejected", async () => {
  saleState["sale-a"].amount = 450;
  const result = await actions.createMarketplaceSettlement(payload());
  assert.ok("error" in result);
  assert.match(result.error ?? "", /ยอดเงินถูกแก้ไข: SO26090001/);
  assert.deepEqual(callLog, LOCK_TRACE);
});

test("several problems are reported together", async () => {
  saleState["sale-a"].status = "CANCELLED";
  saleState["sale-b"].eligible = false;
  creditNoteState["cn-a"].amount = 90;
  const result = await actions.createMarketplaceSettlement(payload());
  assert.deepEqual(result, {
    error:
      "มีเอกสารเปลี่ยนแปลงระหว่างบันทึกรอบรับเงิน — ถูกยกเลิกแล้ว: SO26090001 · " +
      "ถูกกระทบยอดในรอบอื่นแล้วหรือไม่พร้อมกระทบยอด: SO26090002 · ยอดเงินถูกแก้ไข: CN26090001 " +
      "กรุณาโหลดหน้าใหม่แล้วเลือกเอกสารอีกครั้ง",
  });
});

test("a unique-constraint race is still reported with the duplicate message", async () => {
  settlementCreateError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
  const result = await actions.createMarketplaceSettlement(payload());
  assert.deepEqual(result, { error: "เลขอ้างอิงการรับเงินนี้ถูกบันทึกแล้ว หรือมีเอกสารถูกกระทบยอดซ้ำ" });
});

// ── Document-number collisions ───────────────────────────────
// Every generated number (settlementNo, expenseNo, transferNo, adjustNo) is
// "latest + 1" read outside the transaction. A P2002 on one of those columns is
// retried by re-running the WHOLE transaction — row locks and re-checks included —
// with freshly generated numbers. Business uniques are not retried.

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
const BUSINESS_DUPLICATE_MESSAGE = "เลขอ้างอิงการรับเงินนี้ถูกบันทึกแล้ว หรือมีเอกสารถูกกระทบยอดซ้ำ";

/** Same documents, with a 50-baht fee so a fee Expense (expenseNo) is created. */
const payloadWithFee = () => ({
  ...payload(),
  payoutAmount: 850,
  lines: [{ code: "COMMISSION", label: "Commission", kind: "FEE", amount: 50 }],
});

/** Existing Supplier and fee ExpenseCode: read once, before the settlement transaction. */
const FEE_MASTER_ROWS_READ = ["db.supplier.findUnique", "db.expenseCode.findMany"];

const FEE_ATTEMPT_UNTIL_EXPENSE = (expenseNo: string) => [
  ...LOCK_TRACE,
  "cashBankAccount.findFirst",
  `expense.create:${expenseNo}`,
];

test("an expenseNo collision re-runs the whole transaction, locks included, with fresh numbers", async () => {
  expenseCreateErrors = [adapterP2002(['"expenseNo"'])];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  // The whole number set is regenerated for the second attempt.
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090002", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    ...FEE_MASTER_ROWS_READ,
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090001"),
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090002"),
    "cashBank.replace:EXPENSE",
    "cashBankTransfer.create",
    "cashBank.replace:TRANSFER",
    "marketplaceSettlement.create",
    "profitFacts.rebuild:set-1",
  ]);
  assert.equal(callLog.filter((entry) => entry === "lock:Sale:sale-a,sale-b").length, 2);
  assert.equal(consoleErrors, 0);
});

test("when every retry collides on a document number, a Thai retry message is returned", async () => {
  expenseCreateErrors = [
    adapterP2002(['"expenseNo"']),
    adapterP2002(['"expenseNo"']),
    adapterP2002(['"expenseNo"']),
  ];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { error: DOC_NUMBER_CONFLICT_MESSAGE });
  assert.deepEqual(
    callLog.filter((entry) => entry.startsWith("expense.create:")),
    ["expense.create:OE26090001", "expense.create:OE26090002", "expense.create:OE26090003"],
  );
  assert.equal(callLog.filter((entry) => entry === "lock:CreditNote:cn-a").length, 3);
  assert.ok(!callLog.includes("marketplaceSettlement.create"));
});

test("a settlementNo collision on the last insert is retried too", async () => {
  let failures = 1;
  const original = fakeTx.marketplaceSettlement as Record<string, FakeFn>;
  const originalCreate = original.create;
  original.create = async (...args: unknown[]) => {
    if (failures > 0) {
      failures -= 1;
      record("marketplaceSettlement.create");
      throw adapterP2002(['"settlementNo"']);
    }
    return originalCreate(...args);
  };
  try {
    const result = await actions.createMarketplaceSettlement(payload());
    assert.deepEqual(result, { success: true, settlementNo: "SPS26090002", payoutDifference: 0 });
    assert.equal(callLog.filter((entry) => entry === "marketplaceSettlement.create").length, 2);
  } finally {
    original.create = originalCreate;
  }
});

test("business uniques ([channel, payoutRef], activeSaleId, activeCreditNoteId) keep the old message and are not retried", async () => {
  for (const fields of [['"channel"', '"payoutRef"'], ['"activeSaleId"'], ['"activeCreditNoteId"']]) {
    callLog = [];
    docNumberSeq = {};
    settlementCreateError = adapterP2002(fields);
    const result = await actions.createMarketplaceSettlement(payload());
    assert.deepEqual(result, { error: BUSINESS_DUPLICATE_MESSAGE }, fields.join(","));
    assert.equal(callLog.filter((entry) => entry === "marketplaceSettlement.create").length, 1, fields.join(","));
  }
});

// ── Auto-created master rows on first concurrent use ─────────────────────────
// The Supplier and fee ExpenseCodes a fee Expense references are found or created
// BEFORE the settlement transaction. A concurrent first settlement that created the
// same row first (P2002 on Supplier.name / ExpenseCode.code) is re-read and reused,
// so the settlement neither fails with the duplicate-payout message nor is aborted.

const FEE_CODE_NAME = "Shopee — Commission";
const FEE_CODE_DESCRIPTION = "ค่าธรรมเนียม Shopee จากการกระทบยอดแบบคีย์เอง";
const FEE_SETTLEMENT_TAIL = [
  "cashBank.replace:EXPENSE",
  "cashBankTransfer.create",
  "cashBank.replace:TRANSFER",
  "marketplaceSettlement.create",
  "profitFacts.rebuild:set-1",
];

type CreatedExpenseData = {
  supplierId: string;
  items: { create: { expenseCodeId: string }[] };
};

test("first use creates the Supplier with its audit row before the settlement transaction", async () => {
  dbSupplierReads = [null];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090001", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    "db.supplier.findUnique",
    "tx.supplier.create",
    "tx.auditLog.create",
    "db.expenseCode.findMany",
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090001"),
    ...FEE_SETTLEMENT_TAIL,
  ]);
  assert.equal((lastExpenseData as CreatedExpenseData).supplierId, "sup-new");
});

test("a P2002 on Supplier.name from a concurrent first settlement re-reads and reuses its Supplier", async () => {
  dbSupplierReads = [null, { id: "sup-winner" }];
  supplierCreateErrors = [adapterP2002(['"name"'])];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090001", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    "db.supplier.findUnique",
    "tx.supplier.create",
    "db.supplier.findUnique",
    "db.expenseCode.findMany",
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090001"),
    ...FEE_SETTLEMENT_TAIL,
  ]);
  assert.equal((lastExpenseData as CreatedExpenseData).supplierId, "sup-winner");
  assert.equal(consoleErrors, 0);
});

test("first use creates the fee ExpenseCode with the same code / name / description as before", async () => {
  dbExpenseCodesExist = false;
  txExpenseCodeReads = [[]];
  usedFeeCodes = ["SHP001", "SHP007"];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090001", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    "db.supplier.findUnique",
    "db.expenseCode.findMany",
    "advisoryLock:auto-expense-code",
    "tx.expenseCode.findMany:name",
    "tx.expenseCode.findMany:code:SHP",
    `tx.expenseCode.create:SHP008:${FEE_CODE_NAME}:${FEE_CODE_DESCRIPTION}`,
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090001"),
    ...FEE_SETTLEMENT_TAIL,
  ]);
  assert.deepEqual(
    (lastExpenseData as CreatedExpenseData).items.create.map((item) => item.expenseCodeId),
    ["new:SHP008"],
  );
});

test("a P2002 on ExpenseCode.code from a concurrent first settlement re-reads and reuses its code", async () => {
  dbExpenseCodesExist = false;
  // The concurrent settlement committed the code between our by-name read and our insert.
  txExpenseCodeReads = [[], [{ id: "code-winner", name: FEE_CODE_NAME }]];
  expenseCodeCreateErrors = [adapterP2002(['"code"'])];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { success: true, settlementNo: "SPS26090001", payoutDifference: 0 });
  assert.deepEqual(callLog, [
    "db.supplier.findUnique",
    "db.expenseCode.findMany",
    "advisoryLock:auto-expense-code",
    "tx.expenseCode.findMany:name",
    "tx.expenseCode.findMany:code:SHP",
    `tx.expenseCode.create:SHP001:${FEE_CODE_NAME}:${FEE_CODE_DESCRIPTION}`,
    "advisoryLock:auto-expense-code",
    "tx.expenseCode.findMany:name",
    ...FEE_ATTEMPT_UNTIL_EXPENSE("OE26090001"),
    ...FEE_SETTLEMENT_TAIL,
  ]);
  assert.deepEqual(
    (lastExpenseData as CreatedExpenseData).items.create.map((item) => item.expenseCodeId),
    ["code-winner"],
  );
  assert.equal(consoleErrors, 0);
});

test("when every ExpenseCode attempt collides, the settlement is not started and the generic message is returned", async () => {
  dbExpenseCodesExist = false;
  expenseCodeCreateErrors = [adapterP2002(['"code"']), adapterP2002(['"code"']), adapterP2002(['"code"'])];
  const result = await actions.createMarketplaceSettlement(payloadWithFee());
  assert.deepEqual(result, { error: "บันทึกการกระทบยอดไม่สำเร็จ" });
  assert.equal(callLog.filter((entry) => entry.startsWith("tx.expenseCode.create:")).length, 3);
  assert.ok(!callLog.includes("lock:CreditNote:cn-a"), "the settlement transaction never ran");
  assert.equal(consoleErrors, 1);
});
