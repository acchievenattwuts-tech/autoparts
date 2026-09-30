import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";
// Type-only: the helper module (and lib/period-lock-document) must load after the module mocks.
import type { ExpenseFinancialState } from "../expense-period-lock";

// Month lock on expenses (owner decisions T2 / ก1 / ก2 / P4): an expense dated in a month whose
// profit was distributed cannot be created, changed or cancelled — a note or line-description edit
// stays free — unless an admin with period_lock.override gives a reason (audited + alerted).
// Checked under the Expense row lock, before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const makeClient = (overrides: () => ModelOverrides, calls: Call[], queryRaw: () => unknown[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return modelName === "$queryRaw" ? queryRaw() : 0;
          };
        }
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (args: unknown) => {
                calls.push({ method: `${modelName}.${method}`, args });
                if (override) return override(args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id`, count: 0 };
              };
            },
          },
        );
      },
    },
  );

const WRITE_METHOD = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

const EXPENSE_DATE = parseDateOnlyToDate("2026-08-20");
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const sideWrites: string[] = [];
let declaredPeriods: Record<string, string> = {};
let sessionPermissions: string[] = [];
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];

const storedExpense = {
  id: "exp1",
  expenseNo: "EX26080001",
  expenseDate: EXPENSE_DATE,
  status: "ACTIVE",
  supplierId: "sup-1",
  vatType: "NO_VAT",
  vatRate: 0,
  note: "เดิม",
  supplier: null,
  cashBankAccount: null,
  items: [{ id: "item-1", expenseCodeId: "code-1", description: null, amount: 100, expenseCode: { code: "E01", name: "ค่าน้ำ" } }],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => [{ status: "ACTIVE", expenseDate: EXPENSE_DATE }]);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, [], () => []),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      safeNotifyPeriodLockOverride: async (input: Record<string, unknown>) => {
        alerts.push(input);
      },
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "เจ้าของร้าน", permissions: sessionPermissions } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (input: Record<string, unknown>) => {
        audits.push(input);
      },
    },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.clear");
      },
      replaceCashBankSourceMovements: async () => {
        sideWrites.push("cashBank.replace");
      },
    },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: {
      ...realPayments,
      clearDocumentPayments: async () => {
        sideWrites.push("payments.clear");
      },
      replaceDocumentPayments: async () => {
        sideWrites.push("payments.replace");
      },
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      ...realProfitFact,
      rebuildExpenseProfitFacts: async () => {
        sideWrites.push("profitFacts.rebuild");
      },
    },
  });
  const realWht = await import("@/lib/wht-certificate");
  await mock.module("@/lib/wht-certificate", {
    namedExports: {
      ...realWht,
      cancelWhtCertificateForSource: async () => {
        sideWrites.push("wht.cancel");
      },
      persistWhtCertificate: async () => {
        sideWrites.push("wht.persist");
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateExpenseNo: async () => "EX26080002" },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  txCalls.length = 0;
  sideWrites.length = 0;
  audits.length = 0;
  alerts.length = 0;
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = ["expenses.update", "expenses.cancel", "expenses.create"];
  dbOverrides = { expense: { findUnique: async () => storedExpense } };
  txOverrides = {
    expense: { findUnique: async () => storedExpense },
    documentPayment: { findMany: async () => [{ cashBankAccountId: "acc-1", amount: 100 }] },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const expenseForm = (overrides: Record<string, string> = {}) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    expenseDate: "2026-08-20",
    supplierId: "sup-1",
    note: "เดิม",
    items: JSON.stringify([{ expenseCodeId: "code-1", amount: 100 }]),
    payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: 100 }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const cancelForm = (reason?: string) => {
  const form = new FormData();
  form.set("expenseId", "exp1");
  if (reason !== undefined) form.set(PERIOD_LOCK_REASON_FIELD, reason);
  return form;
};

const REASON = "ใบเสร็จผู้ขายแก้ยอดภายหลัง";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(alerts.length, 0);
};

test("comparison: the note and line descriptions are free; lines, payee, VAT, payments and WHT are financial", { skip: moduleMocksUnavailable }, async () => {
  const { isExpenseNonFinancialChange } = await import("../expense-period-lock");
  const base: ExpenseFinancialState = {
    expenseDate: EXPENSE_DATE,
    supplierId: "sup-1",
    vatType: "NO_VAT",
    vatRate: "0.00",
    inputVatRecoverable: false,
    items: [{ expenseCodeId: "code-1", description: null, amount: "100.00" }],
    payments: [{ cashBankAccountId: "acc-1", amount: "100.00" }],
    whtLines: [],
  };
  assert.equal(isExpenseNonFinancialChange(base, { ...base, vatRate: 0, items: [{ expenseCodeId: "code-1", description: "", amount: 100 }] }), true);
  assert.equal(isExpenseNonFinancialChange(base, { ...base, supplierId: "sup-2" }), false);
  // V7: a change that flips input-VAT recoverability moves the expense amount, so it is financial.
  assert.equal(isExpenseNonFinancialChange(base, { ...base, inputVatRecoverable: true }), false);
  assert.equal(isExpenseNonFinancialChange(base, { ...base, items: [{ expenseCodeId: "code-1", description: null, amount: 90 }] }), false);
  // A line description is a remark (P4).
  assert.equal(isExpenseNonFinancialChange(base, { ...base, items: [{ expenseCodeId: "code-1", description: "ค่าน้ำ", amount: 100 }] }), true);
  assert.equal(isExpenseNonFinancialChange(base, { ...base, items: [{ expenseCodeId: "code-2", description: null, amount: 100 }] }), false);
  assert.equal(isExpenseNonFinancialChange(base, { ...base, payments: [{ cashBankAccountId: "acc-2", amount: 100 }] }), false);
  assert.equal(
    isExpenseNonFinancialChange(base, {
      ...base,
      whtLines: [{ incomeTypeId: "it-1", baseAmount: 100, rate: 3, taxAmount: 3, payCondition: "WITHHELD" }],
    }),
    false,
  );
});

test("createExpense in a distributed month is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createExpense } = await import("../actions");
  assertRejectedWithoutWrites(await createExpense(expenseForm()));
});

test("updateExpense: an amount change in a distributed month is rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateExpense } = await import("../actions");
  assertRejectedWithoutWrites(
    await updateExpense("exp1", expenseForm({
      items: JSON.stringify([{ expenseCodeId: "code-1", amount: 90 }]),
      payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: 90 }]),
    })),
  );
});

test("updateExpense: a note-only edit in a distributed month writes the note only", { skip: moduleMocksUnavailable }, async () => {
  const { updateExpense } = await import("../actions");
  const result = await updateExpense("exp1", expenseForm({ note: "แนบใบเสร็จแล้ว" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["expense.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, { note: "แนบใบเสร็จแล้ว", taxInvoiceNo: null, taxInvoiceDate: null });
  assert.deepEqual(sideWrites, [], "payments, cash/bank, WHT and profit facts untouched");
});

test("updateExpense (P4): a line-description edit saves that text only — no payments, WHT or profit facts", { skip: moduleMocksUnavailable }, async () => {
  const { updateExpense } = await import("../actions");
  const result = await updateExpense(
    "exp1",
    expenseForm({ items: JSON.stringify([{ expenseCodeId: "code-1", description: "ค่าน้ำประปา ส.ค.", amount: 100 }]) }),
  );
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["expense.update", "expenseItem.update"]);
  assert.deepEqual(writes[1].args, { where: { id: "item-1" }, data: { description: "ค่าน้ำประปา ส.ค." } });
  assert.deepEqual(sideWrites, [], "payments, cash/bank, WHT and profit facts untouched");
  assert.equal(alerts.length, 0);
});

/** V7: a VAT expense (100 + 7% = 107) whose tax invoice is dated 2026-08-21. */
const vatStoredExpense = { ...storedExpense, vatType: "EXCLUDING_VAT", vatRate: 7, taxInvoiceNo: "INV-1",
  taxInvoiceDate: parseDateOnlyToDate("2026-08-21") };
const vatExpenseForm = (overrides: Record<string, string> = {}) => expenseForm({
  vatType: "EXCLUDING_VAT", vatRate: "7", taxInvoiceNo: "INV-1", taxInvoiceDate: "2026-08-21",
  payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: 107 }]), ...overrides,
});
const useVatExpense = (registeredFrom: string) => {
  txOverrides.expense = { findUnique: async () => vatStoredExpense };
  txOverrides.documentPayment = { findMany: async () => [{ cashBankAccountId: "acc-1", amount: 107 }] };
  txOverrides.siteContent = { findUnique: async () => ({ value: registeredFrom }) };
};

test("V5: a VAT expense needs the tax-invoice number and date; NO_VAT does not", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { createExpense } = await import("../actions");
  const missing = await createExpense(vatExpenseForm({ taxInvoiceNo: "", taxInvoiceDate: "" }));
  assert.equal(missing.error, "กรุณาระบุเลขที่ใบกำกับภาษี (บังคับเมื่อมี VAT)");
  assert.equal((await createExpense(vatExpenseForm({ taxInvoiceDate: "" }))).error, "กรุณาระบุวันที่ใบกำกับภาษี (บังคับเมื่อมี VAT)");
  assert.equal((await createExpense(vatExpenseForm({ taxInvoiceDate: "21/08/2026" }))).error, "วันที่ใบกำกับภาษีไม่ถูกต้อง");
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.equal((await createExpense(expenseForm())).success, true);
  const created = await createExpense(vatExpenseForm());
  assert.equal(created.success, true);
  const data = (txCalls.filter((call) => call.method === "expense.create").at(-1)?.args as { data: Record<string, unknown> }).data;
  assert.deepEqual([data.taxInvoiceNo, data.taxInvoiceDate, data.netAmount], ["INV-1", parseDateOnlyToDate("2026-08-21"), 107]);
});

test("V7: in a distributed month, a tax-invoice edit that keeps the VAT recoverable is a remark", { skip: moduleMocksUnavailable }, async () => {
  useVatExpense("2026-08-01");
  const { updateExpense } = await import("../actions");
  assert.deepEqual(await updateExpense("exp1", vatExpenseForm({ taxInvoiceNo: "INV-1A", taxInvoiceDate: "2026-08-22" })), { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["expense.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data,
    { note: "เดิม", taxInvoiceNo: "INV-1A", taxInvoiceDate: parseDateOnlyToDate("2026-08-22") });
  assert.deepEqual(sideWrites, [], "payments, cash/bank, WHT and profit facts untouched");
});

test("V7: in a distributed month, a tax-invoice date that flips the VAT back to cost is financial", { skip: moduleMocksUnavailable }, async () => {
  // Registered from 2026-08-21: the stored date is recoverable, 2026-08-20 is not (expense 100 -> 107).
  useVatExpense("2026-08-21");
  const { updateExpense } = await import("../actions");
  assertRejectedWithoutWrites(await updateExpense("exp1", vatExpenseForm({ taxInvoiceDate: "2026-08-20" })));
});

test("cancelExpense: rejected without the permission, or with an empty reason", { skip: moduleMocksUnavailable }, async () => {
  const { cancelExpense } = await import("../actions");
  assertRejectedWithoutWrites(await cancelExpense(cancelForm(REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelExpense(cancelForm("")));
});

test("cancelExpense: an admin with a reason cancels; the reason is audited and alerted", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { cancelExpense } = await import("../actions");
  assert.deepEqual(await cancelExpense(cancelForm(REASON)), { success: true });
  assert.ok(sideWrites.includes("profitFacts.rebuild"));
  const meta = audits[0]?.meta as { cancelNote: null; periodLockOverride?: { reason: string } };
  assert.equal(meta.periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].entityType, "Expense");
  assert.equal(alerts[0].docNo, "EX26080001");
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { updateExpense, cancelExpense } = await import("../actions");
  assert.deepEqual(await updateExpense("exp1", expenseForm({ items: JSON.stringify([{ expenseCodeId: "code-1", amount: 90 }]), payments: JSON.stringify([{ cashBankAccountId: "acc-1", amount: 90 }]) })), { success: true });
  assert.deepEqual(await cancelExpense(cancelForm()), { success: true });
  assert.equal(alerts.length, 0);
});
