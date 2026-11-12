import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { getThailandDateKey, parseDateOnlyToDate } from "@/lib/th-date";

/**
 * I7: a supplier payment row-locks the purchases and purchase-return credits it settles BEFORE it reads their
 * outstanding balance, so two payments of the same purchase serialize and a purchase cancelled meanwhile is seen.
 * I9: a paymentNo taken by another save between "latest + 1" and the insert is regenerated and retried.
 *
 * The fake database keeps committed rows, gives each dbTx its own uncommitted writes (applied on commit, dropped on
 * rollback), enforces the unique paymentNo, and blocks a FOR UPDATE on a row another open transaction holds — the
 * READ COMMITTED behaviour the action runs under.
 */

type Status = "ACTIVE" | "CANCELLED";
type DocRow = { id: string; no: string; date: Date; total: number; amountRemain: number; status: Status };
type PaymentRow = { id: string; paymentNo: string; status: Status; data: Record<string, unknown> };
type ItemRow = {
  paymentId: string; lineNo: number; debitNoteId: string | null; purchaseId: string | null;
  purchaseReturnId: string | null; advanceId: string | null; paidAmount: number;
};
type Pending = { payments: PaymentRow[]; items: ItemRow[]; replacedItemsOf: string[]; cancelled: string[] };
type ItemKey = "purchaseId" | "purchaseReturnId" | "advanceId" | "debitNoteId";
type UsageSelect = { where: { paymentId: string } };

class RowLocks {
  private held = new Map<string, { owner: number; released: Promise<void>; release: () => void }>();

  async acquire(owner: number, key: string): Promise<void> {
    for (let current = this.held.get(key); current && current.owner !== owner; current = this.held.get(key)) {
      await current.released;
    }
    if (this.held.get(key)?.owner === owner) return;
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.held.set(key, { owner, released, release });
  }

  releaseAll(owner: number): void {
    for (const [key, lock] of [...this.held]) {
      if (lock.owner !== owner) continue;
      this.held.delete(key);
      lock.release();
    }
  }
}

const DAY = parseDateOnlyToDate("2026-09-01");
const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

let locks: RowLocks;
let txSeq = 0;
let store: { purchases: DocRow[]; credits: DocRow[]; advances: DocRow[]; debits: DocRow[]; payments: PaymentRow[]; items: ItemRow[] };
let trace: string[];
let generated: string[];
/** Simulates another user committing the number this save just generated (the I9 race). */
let takeGeneratedNumber: (paymentNo: string, attempt: number) => boolean;

const uniqueViolation = (): Error =>
  new Prisma.PrismaClientKnownRequestError("Invalid `prisma.supplierPayment.create()` invocation: Unique constraint failed on the fields: (`paymentNo`)", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { fields: ['"paymentNo"'] } } } },
  });

const isActivePayment = (paymentId: string): boolean => store.payments.some((row) => row.id === paymentId && row.status === "ACTIVE");
const paidOn = (key: ItemKey, id: string): number =>
  store.items.filter((item) => item[key] === id && isActivePayment(item.paymentId)).reduce((sum, item) => sum + item.paidAmount, 0);
const usage = (key: ItemKey, id: string, paymentId: string): Array<{ paidAmount: Prisma.Decimal }> =>
  store.items.filter((item) => item[key] === id && item.paymentId === paymentId).map((item) => ({ paidAmount: new Prisma.Decimal(item.paidAmount) }));

const commit = (pending: Pending): void => {
  store.items = store.items.filter((item) => !pending.replacedItemsOf.includes(item.paymentId));
  store.payments.push(...pending.payments);
  store.items.push(...pending.items);
  for (const id of pending.cancelled) {
    const row = store.payments.find((payment) => payment.id === id);
    if (row) row.status = "CANCELLED";
  }
  for (const row of store.purchases) row.amountRemain = row.total - paidOn("purchaseId", row.id);
  for (const row of store.credits) row.amountRemain = row.total - paidOn("purchaseReturnId", row.id);
  for (const row of store.advances) row.amountRemain = row.total - paidOn("advanceId", row.id);
  for (const row of store.debits) row.amountRemain = row.total - paidOn("debitNoteId", row.id);
};

const readRawQuery = (first: unknown, rest: unknown[]): { sql: string; values: unknown[] } =>
  (Array.isArray(first) ? Prisma.sql(first as unknown as TemplateStringsArray, ...(rest as Prisma.Sql[])) : first) as Prisma.Sql;

const makeTx = (owner: number, pending: Pending) => ({
  $queryRaw: async (first: unknown, ...rest: unknown[]): Promise<unknown[]> => {
    const { sql, values } = readRawQuery(first, rest);
    const table = /FROM\s+"(\w+)"/.exec(sql)?.[1] ?? "?";
    const ids = values.filter((value): value is string => typeof value === "string");
    if (/FOR UPDATE/.test(sql)) {
      for (const id of ids) await locks.acquire(owner, `${table}:${id}`);
      trace.push(`lock:${table}:${ids.join(",")}`);
    }
    return [];
  },
  purchase: {
    findMany: async (args: { select: { supplierPaymentItems: UsageSelect } }) => {
      trace.push("read:Purchase");
      const exclude = args.select.supplierPaymentItems.where.paymentId;
      return store.purchases
        .filter((row) => row.status === "ACTIVE" && (row.amountRemain > 0 || usage("purchaseId", row.id, exclude).length > 0))
        .map((row) => ({ id: row.id, purchaseNo: row.no, purchaseDate: row.date, netAmount: new Prisma.Decimal(row.total),
          amountRemain: new Prisma.Decimal(row.amountRemain), supplierPaymentItems: usage("purchaseId", row.id, exclude) }));
    },
  },
  purchaseReturn: {
    findMany: async (args: { select: { supplierPaymentItems: UsageSelect } }) => {
      trace.push("read:PurchaseReturn");
      const exclude = args.select.supplierPaymentItems.where.paymentId;
      return store.credits
        .filter((row) => row.status === "ACTIVE" && (row.amountRemain > 0 || usage("purchaseReturnId", row.id, exclude).length > 0))
        .map((row) => ({ id: row.id, returnNo: row.no, returnDate: row.date, totalAmount: new Prisma.Decimal(row.total),
          amountRemain: new Prisma.Decimal(row.amountRemain), supplierPaymentItems: usage("purchaseReturnId", row.id, exclude) }));
    },
  },
  supplierAdvance: {
    findMany: async (args: { select: { supplierPayments: UsageSelect } }) => {
      trace.push("read:SupplierAdvance");
      const exclude = args.select.supplierPayments.where.paymentId;
      return store.advances
        .filter((row) => row.status === "ACTIVE" && (row.amountRemain > 0 || usage("advanceId", row.id, exclude).length > 0))
        .map((row) => ({ id: row.id, advanceNo: row.no, advanceDate: row.date, totalAmount: new Prisma.Decimal(row.total),
          amountRemain: new Prisma.Decimal(row.amountRemain), supplierPayments: usage("advanceId", row.id, exclude) }));
    },
  },
  supplierDebitNote: {
    findMany: async (args: { where: { id?: unknown; netAmount?: { gt?: number } }; select?: { supplierPaymentItems?: UsageSelect } }) => {
      if (args.where.id) return [];
      if (args.where.netAmount?.gt === undefined) return [];
      trace.push("read:SupplierDebitNote");
      const exclude = args.select?.supplierPaymentItems?.where.paymentId ?? "__never__";
      return store.debits
        .filter((row) => row.status === "ACTIVE" && (row.amountRemain > 0 || usage("debitNoteId", row.id, exclude).length > 0))
        .map((row) => ({ id: row.id, debitNo: row.no, postingDate: row.date, netAmount: new Prisma.Decimal(row.total),
          amountRemain: new Prisma.Decimal(row.amountRemain), adjustsDebitNote: null, supplierPaymentItems: usage("debitNoteId", row.id, exclude) }));
    },
  },
  cashBankAccount: { findMany: async () => [{ type: "BANK" }] },
  supplierPayment: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      // Hold the transaction open across a timer, so a second save runs its reads while this one is uncommitted.
      await delay(15);
      const paymentNo = String(data.paymentNo);
      if ([...store.payments, ...pending.payments].some((row) => row.paymentNo === paymentNo)) throw uniqueViolation();
      txSeq += 1;
      const row: PaymentRow = { id: `pay-new-${txSeq}`, paymentNo, status: "ACTIVE", data };
      pending.payments.push(row);
      return { id: row.id, ...data };
    },
    update: async ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
      await delay(15);
      if (data.status === "CANCELLED") pending.cancelled.push(where.id);
      return { id: where.id };
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = store.payments.find((payment) => payment.id === where.id);
      if (!row) return null;
      return { status: row.status, items: store.items.filter((item) => item.paymentId === row.id).sort((a, b) => a.lineNo - b.lineNo)
        .map((item) => ({ debitNoteId: item.debitNoteId, purchaseId: item.purchaseId, purchaseReturnId: item.purchaseReturnId, advanceId: item.advanceId })) };
    },
  },
  supplierPaymentItem: {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      pending.items.push(...data.map((item) => ({
        paymentId: String(item.paymentId), lineNo: Number(item.lineNo), debitNoteId: (item.debitNoteId as string | null) ?? null,
        purchaseId: (item.purchaseId as string | null) ?? null, purchaseReturnId: (item.purchaseReturnId as string | null) ?? null,
        advanceId: (item.advanceId as string | null) ?? null, paidAmount: Number(item.paidAmount),
      })));
      return { count: data.length };
    },
    deleteMany: async ({ where }: { where: { paymentId: string } }) => {
      pending.replacedItemsOf.push(where.paymentId);
      return { count: 0 };
    },
  },
  documentPayment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) },
});

const dbTx = async (callback: (client: ReturnType<typeof makeTx>) => Promise<unknown>): Promise<unknown> => {
  txSeq += 1;
  const owner = txSeq;
  const pending: Pending = { payments: [], items: [], replacedItemsOf: [], cancelled: [] };
  try {
    const result = await callback(makeTx(owner, pending));
    commit(pending);
    return result;
  } finally {
    locks.releaseAll(owner);
  }
};

/** Same "latest + 1 per month" rule as lib/doc-number.ts, over the committed rows. */
const nextPaymentNo = (date: Date): string => {
  const [year, month] = getThailandDateKey(date).split("-");
  const pattern = `PAY${year.slice(-2)}${month}`;
  const last = store.payments.map((row) => row.paymentNo).filter((no) => no.startsWith(pattern)).sort().at(-1);
  const seq = last ? Number(last.slice(pattern.length)) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
};

let actions: typeof import("../actions");

before(async () => {
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/require-auth", { namedExports: {
    requirePermission: async () => ({ user: { id: "user-1", permissions: [] } }),
    requireAnyPermission: async () => ({ user: { id: "user-1", permissions: [] } }),
  } });
  await mock.module("@/lib/audit-log", { namedExports: { diffEntity: () => ({ before: {}, after: {} }),
    getAuditActorFromSession: () => ({ userId: "user-1" }), getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined } });
  await mock.module("@/lib/db", { namedExports: {
    db: {
      supplierPayment: {
        // The pre-transaction read of update / cancel; the audit snapshot (include) is skipped.
        findUnique: async (args: { where: { id: string }; include?: unknown }) => {
          if (args.include) return null;
          const row = store.payments.find((payment) => payment.id === args.where.id);
          if (!row) return null;
          return { id: row.id, paymentNo: row.paymentNo, status: row.status, items: store.items.filter((item) => item.paymentId === row.id)
            .map((item) => ({ debitNoteId: item.debitNoteId, purchaseId: item.purchaseId, purchaseReturnId: item.purchaseReturnId, advanceId: item.advanceId })) };
        },
      },
      documentPayment: { findMany: async () => [] },
    },
    dbTx,
  } });
  await mock.module("@/lib/doc-number", { namedExports: {
    generateSupplierPaymentNo: async (date: Date) => {
      const paymentNo = nextPaymentNo(date);
      generated.push(paymentNo);
      if (takeGeneratedNumber(paymentNo, generated.length)) {
        store.payments.push({ id: `pay-other-${generated.length}`, paymentNo, status: "ACTIVE", data: {} });
      }
      return paymentNo;
    },
  } });
  await mock.module("@/lib/supplier-debit-note", { namedExports: { recalculateSupplierDebitRemain: async () => undefined } });
  await mock.module("@/lib/amount-remain", { namedExports: {
    recalculatePurchaseAmountRemain: async () => undefined, recalculatePurchaseReturnAmountRemain: async () => undefined,
    recalculateSupplierAdvanceAmountRemain: async () => undefined,
  } });
  await mock.module("@/lib/cash-bank", { namedExports: {
    replaceCashBankSourceMovements: async () => undefined, clearCashBankSourceMovements: async () => undefined,
  } });
  await mock.module("@/lib/wht-certificate", { namedExports: { persistWhtCertificate: async () => undefined, cancelWhtCertificateForSource: async () => undefined } });
  actions = await import("../actions");
});

beforeEach(() => {
  locks = new RowLocks();
  trace = [];
  generated = [];
  takeGeneratedNumber = () => false;
  const doc = (id: string, no: string, total: number): DocRow => ({ id, no, date: DAY, total, amountRemain: total, status: "ACTIVE" });
  store = {
    purchases: [doc("po-1", "RRC26090001", 1000), doc("po-2", "RRC26090002", 500)],
    credits: [doc("pr-1", "CNRR26090001", 100)],
    advances: [doc("adv-1", "ADV26090001", 100)],
    debits: [doc("dn-1", "SDN26090001", 100)],
    payments: [],
    items: [],
  };
});

const form = (items: unknown[], cash: number, paymentDate = "2026-09-30"): FormData => {
  const data = new FormData();
  data.set("supplierId", "supplier-1"); data.set("paymentDate", paymentDate); data.set("note", ""); data.set("wht", "");
  data.set("payments", JSON.stringify(cash > 0 ? [{ cashBankAccountId: "acc-bank", amount: cash }] : []));
  data.set("items", JSON.stringify(items));
  return data;
};

const seedPayment = (id: string, paymentNo: string, items: Array<Pick<ItemRow, "purchaseId" | "paidAmount">>): void => {
  store.payments.push({ id, paymentNo, status: "ACTIVE", data: {} });
  store.items.push(...items.map((item, index) => ({ paymentId: id, lineNo: index + 1, debitNoteId: null, purchaseReturnId: null,
    advanceId: null, ...item })));
  commit({ payments: [], items: [], replacedItemsOf: [], cancelled: [] });
};

const lockAndReadTrace = (): string[] => trace.filter((entry) => entry.startsWith("lock:") || entry.startsWith("read:"));

describe("I7 — the purchase is locked before its balance is read", () => {
  it("an edit raising payment 1 while payment 2 is created for the same purchase: one passes, the debt is never overpaid", async () => {
    seedPayment("pay-1", "PAY26090001", [{ purchaseId: "po-1", paidAmount: 200 }]);
    const results = await Promise.all([
      actions.updateSupplierPayment("pay-1", form([{ purchaseId: "po-1", paidAmount: 600 }], 600)),
      actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 600 }], 600)),
    ]);
    assert.equal(results.filter((result) => result.success).length, 1);
    assert.deepEqual(results.filter((result) => !result.success).map((result) => result.error),
      ["ยอดชำระของ RRC26090001 มากกว่ายอดคงเหลือที่ใช้ได้"]);
    // Whichever saved first, the purchase is never paid past its 1,000.
    assert.ok(paidOn("purchaseId", "po-1") <= 1000);
    assert.ok(store.purchases[0].amountRemain >= 0);
  });

  it("two new payments of the same purchase at once (different months, no number clash): only one passes", async () => {
    const results = await Promise.all([
      actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 600 }], 600, "2026-09-30")),
      actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 600 }], 600, "2026-10-01")),
    ]);
    assert.equal(results.filter((result) => result.success).length, 1);
    assert.deepEqual(results.filter((result) => !result.success).map((result) => result.error),
      ["ยอดชำระของ RRC26090001 มากกว่ายอดคงเหลือที่ใช้ได้"]);
    assert.deepEqual([...generated].sort(), ["PAY26090001", "PAY26100001"]);
    assert.equal(paidOn("purchaseId", "po-1"), 600);
    assert.equal(store.purchases[0].amountRemain, 400);
  });

  it("a purchase cancelled while the payment waits for its row lock is refused", async () => {
    const cancelOwner = -1;
    await locks.acquire(cancelOwner, "Purchase:po-1");
    const pendingPayment = actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 300 }], 300));
    await delay(30);
    store.purchases[0].status = "CANCELLED";
    locks.releaseAll(cancelOwner);
    const result = await pendingPayment;
    assert.deepEqual(result, { success: false, error: "พบเอกสารซื้อเชื่อที่เลือกไม่ถูกต้องหรือไม่สามารถใช้งานได้แล้ว" });
    assert.equal(store.payments.length, 0);
  });

  it("create locks DN → advance → purchase return → purchase (ids sorted), all before the first balance read", async () => {
    const result = await actions.createSupplierPayment(form([
      { purchaseId: "po-2", paidAmount: 300 }, { purchaseId: "po-1", paidAmount: 500 }, { debitNoteId: "dn-1", paidAmount: 100 },
      { purchaseReturnId: "pr-1", paidAmount: 100 }, { advanceId: "adv-1", paidAmount: 100 },
    ], 700));
    assert.equal(result.success, true, result.error);
    assert.deepEqual(lockAndReadTrace(), [
      "lock:SupplierDebitNote:dn-1",
      "lock:SupplierAdvance:adv-1",
      "lock:PurchaseReturn:pr-1",
      "lock:Purchase:po-1,po-2",
      "read:Purchase", "read:PurchaseReturn", "read:SupplierAdvance", "read:SupplierDebitNote",
    ]);
  });

  it("update locks the payment row, then the purchases of the old and the new lines, before reading balances", async () => {
    seedPayment("pay-1", "PAY26090001", [{ purchaseId: "po-2", paidAmount: 200 }]);
    const result = await actions.updateSupplierPayment("pay-1", form([{ purchaseId: "po-1", paidAmount: 300 }], 300));
    assert.deepEqual(result, { success: true });
    assert.deepEqual(lockAndReadTrace().slice(0, 3), ["lock:SupplierPayment:pay-1", "lock:Purchase:po-1,po-2", "read:Purchase"]);
    assert.equal(store.purchases[0].amountRemain, 700);
    assert.equal(store.purchases[1].amountRemain, 500);
  });

  it("an edit that raises the amount past what another payment left is refused", async () => {
    seedPayment("pay-1", "PAY26090001", [{ purchaseId: "po-1", paidAmount: 200 }]);
    seedPayment("pay-2", "PAY26090002", [{ purchaseId: "po-1", paidAmount: 700 }]);
    const result = await actions.updateSupplierPayment("pay-1", form([{ purchaseId: "po-1", paidAmount: 400 }], 400));
    assert.deepEqual(result, { error: "ยอดชำระของ RRC26090001 มากกว่ายอดคงเหลือที่ใช้ได้" });
    assert.equal(store.purchases[0].amountRemain, 100);
  });

  it("cancel locks the payment row, then its purchases, before recalculating", async () => {
    seedPayment("pay-1", "PAY26090001", [{ purchaseId: "po-1", paidAmount: 200 }]);
    const data = new FormData();
    data.set("paymentId", "pay-1");
    const result = await actions.cancelSupplierPayment(data);
    assert.deepEqual(result, { success: true });
    assert.deepEqual(lockAndReadTrace(), ["lock:SupplierPayment:pay-1", "lock:Purchase:po-1"]);
    assert.equal(store.purchases[0].amountRemain, 1000);
  });

  it("a single payment saves exactly as before: same number, header and lines", async () => {
    const result = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 1000 }], 1000));
    assert.deepEqual(result, { success: true, paymentNo: "PAY26090001" });
    assert.deepEqual(generated, ["PAY26090001"]);
    assert.equal(store.payments.length, 1);
    const { data } = store.payments[0];
    assert.deepEqual(
      [data.paymentNo, data.supplierId, data.userId, data.totalAmount, data.whtAmount, data.paymentMethod, data.note, data.cashBankAccountId],
      ["PAY26090001", "supplier-1", "user-1", 1000, 0, "TRANSFER", null, "acc-bank"],
    );
    assert.deepEqual(store.items, [
      { paymentId: store.payments[0].id, lineNo: 1, debitNoteId: null, purchaseId: "po-1", purchaseReturnId: null, advanceId: null, paidAmount: 1000 },
    ]);
    assert.equal(store.purchases[0].amountRemain, 0);
  });
});

describe("I9 — a paymentNo collision takes the next number", () => {
  it("the first generated number is taken by another save: saved with the next number, same format", async () => {
    takeGeneratedNumber = (_paymentNo, attempt) => attempt === 1;
    const result = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 400 }], 400));
    assert.deepEqual(result, { success: true, paymentNo: "PAY26090002" });
    assert.deepEqual(generated, ["PAY26090001", "PAY26090002"]);
    assert.match(result.paymentNo ?? "", /^PAY\d{4}\d{4}$/);
    assert.deepEqual(store.payments.map((row) => row.paymentNo), ["PAY26090001", "PAY26090002"]);
    assert.equal(store.items.length, 1);
    assert.equal(store.purchases[0].amountRemain, 600);
  });

  it("a collision on every attempt returns a plain Thai message, not the Prisma text", async () => {
    takeGeneratedNumber = () => true;
    const result = await actions.createSupplierPayment(form([{ purchaseId: "po-1", paidAmount: 400 }], 400));
    assert.deepEqual(result, { success: false, error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกเอกสารจ่ายชำระซัพพลายเออร์ได้" });
    assert.equal(generated.length, 3);
    assert.equal(store.items.length, 0);
  });
});
