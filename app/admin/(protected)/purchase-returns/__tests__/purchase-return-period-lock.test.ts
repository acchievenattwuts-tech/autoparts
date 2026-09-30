import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on purchase returns / purchase debit notes (owner decisions T2 / ก1 / ก2): a return
// dated in a month whose profit was distributed cannot be created, changed or cancelled — a
// note-only edit stays free — unless an admin with period_lock.override gives a reason.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const RETURN_DATE = parseDateOnlyToDate("2026-08-20");
const UPDATED_AT = new Date("2026-08-21T02:00:00.000Z");

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

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const sideWrites: string[] = [];
let declaredPeriods: Record<string, string> = {};
let sessionPermissions: string[] = [];
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];
const criticalReports: unknown[] = [];

const storedReturn = {
  id: "pr1",
  returnNo: "PR26080001",
  returnDate: RETURN_DATE,
  status: "ACTIVE",
  updatedAt: UPDATED_AT,
  purchaseId: null,
  claimId: null,
  supplierId: "sup-1",
  supplier: null,
  type: "DISCOUNT",
  settlementType: "SUPPLIER_CREDIT",
  vatType: "NO_VAT",
  vatRate: 0,
  note: null,
  items: [
    {
      id: "pri-1",
      productId: "p-1",
      qty: 2,
      costPrice: 50,
      showQty: 2,
      showUnitName: "ชิ้น",
      moreDetail: null,
      lotItems: [],
      product: { code: "P1", name: "ไส้กรอง" },
    },
  ],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => [{ status: "ACTIVE", returnDate: RETURN_DATE }]);
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
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
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
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: {
      ...realAmountRemain,
      recalculatePurchaseReturnAmountRemain: async () => {
        sideWrites.push("amountRemain");
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generatePurchaseReturnNo: async () => "PR26080002" },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  txCalls.length = 0;
  sideWrites.length = 0;
  audits.length = 0;
  alerts.length = 0;
  criticalReports.length = 0;
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = ["purchase_returns.update", "purchase_returns.cancel", "purchase_returns.create"];
  dbOverrides = { purchaseReturn: { findUnique: async () => storedReturn } };
  txOverrides = {
    purchaseReturn: { findUnique: async () => storedReturn },
    productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] },
    product: {
      findMany: async () => [{ id: "p-1", avgCost: 50, costPrice: 50, inventoryTracking: "TRACKED", isLotControl: false }],
    },
    supplier: { findUnique: async () => ({ id: "sup-1", isActive: true }) },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const returnForm = (overrides: Record<string, string> = {}, costPrice = 50) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    returnDate: "2026-08-20",
    supplierId: "sup-1",
    type: "DISCOUNT",
    settlementType: "SUPPLIER_CREDIT",
    vatType: "NO_VAT",
    vatRate: "0",
    updatedAt: UPDATED_AT.toISOString(),
    items: JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 2, costPrice }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const cancelForm = (reason?: string) => {
  const form = new FormData();
  form.set("returnId", "pr1");
  if (reason !== undefined) form.set(PERIOD_LOCK_REASON_FIELD, reason);
  return form;
};

const REASON = "ผู้ขายยืนยันยอดลดหนี้ใหม่";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(criticalReports.length, 0);
  assert.equal(alerts.length, 0);
};

test("createPurchaseReturn in a distributed month is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  assertRejectedWithoutWrites(await createPurchaseReturn(returnForm()));
});

test("updatePurchaseReturn: an amount change in a distributed month is rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchaseReturn } = await import("../actions");
  assertRejectedWithoutWrites(await updatePurchaseReturn("pr1", returnForm({}, 40)));
});

test("updatePurchaseReturn: a note-only edit in a distributed month writes the note only", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchaseReturn } = await import("../actions");
  const result = await updatePurchaseReturn("pr1", returnForm({ note: "รอเอกสารตัวจริง" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchaseReturn.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, { note: "รอเอกสารตัวจริง", taxInvoiceNo: null, taxInvoiceDate: null });
  assert.deepEqual(sideWrites, []);
});

test("updatePurchaseReturn (P4): a line-detail edit saves that remark only — no stock, credit or refunds", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchaseReturn } = await import("../actions");
  const form = returnForm();
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 2, costPrice: 50, moreDetail: "ส่งคืนพร้อมกล่อง" }]));
  const result = await updatePurchaseReturn("pr1", form);
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchaseReturn.update", "purchaseReturnItem.update"]);
  assert.deepEqual(writes[1].args, { where: { id: "pri-1" }, data: { moreDetail: "ส่งคืนพร้อมกล่อง" } });
  assert.deepEqual(sideWrites, []);
  assert.equal(alerts.length, 0);
});

test("updatePurchaseReturn: an admin override with a reason runs the full edit and alerts", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { updatePurchaseReturn } = await import("../actions");
  assert.deepEqual(await updatePurchaseReturn("pr1", returnForm({ [PERIOD_LOCK_REASON_FIELD]: REASON }, 40)), { success: true });
  assert.ok(sideWrites.includes("payments.replace"), "the full edit ran");
  const audit = audits.find((entry) => entry.action === "UPDATE");
  assert.equal((audit?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "PR26080001");
});

test("cancelPurchaseReturn: blocked without permission / reason, allowed with both", { skip: moduleMocksUnavailable }, async () => {
  const { cancelPurchaseReturn } = await import("../actions");
  assertRejectedWithoutWrites(await cancelPurchaseReturn(cancelForm(REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelPurchaseReturn(cancelForm("")));
  assert.deepEqual(await cancelPurchaseReturn(cancelForm(REASON)), { success: true });
  assert.equal(alerts.length, 1);
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { updatePurchaseReturn, cancelPurchaseReturn } = await import("../actions");
  assert.deepEqual(await updatePurchaseReturn("pr1", returnForm({}, 40)), { success: true });
  assert.deepEqual(await cancelPurchaseReturn(cancelForm()), { success: true });
  assert.equal(alerts.length, 0);
});

// ── V5 / V3: the supplier credit-note number/date are remarks unless recoverability flips ──

const vatReturn = (overrides: Record<string, unknown>) => ({
  ...storedReturn,
  vatType: "EXCLUDING_VAT",
  vatRate: 7,
  taxInvoiceNo: "CN-S-1",
  taxInvoiceDate: parseDateOnlyToDate("2026-07-31"),
  purchase: null,
  ...overrides,
});

const useStoredReturn = (row: Record<string, unknown>) => {
  dbOverrides = { purchaseReturn: { findUnique: async () => row } };
  txOverrides = { ...txOverrides, purchaseReturn: { findUnique: async () => row } };
};

const vatReturnForm = (overrides: Record<string, string>) =>
  returnForm({ vatType: "EXCLUDING_VAT", vatRate: "7", taxInvoiceNo: "CN-S-1", ...overrides });

test("V5: the credit-note number/date of an unreferenced VAT return are remarks while recoverability is unchanged", { skip: moduleMocksUnavailable }, async () => {
  useStoredReturn(vatReturn({ taxInvoiceNo: null, taxInvoiceDate: null }));
  const { updatePurchaseReturn } = await import("../actions");
  const result = await updatePurchaseReturn("pr1", vatReturnForm({ taxInvoiceNo: "CN-S-2", taxInvoiceDate: "2026-08-20" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchaseReturn.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, {
    note: null, taxInvoiceNo: "CN-S-2", taxInvoiceDate: parseDateOnlyToDate("2026-08-20"),
  });
  assert.deepEqual(sideWrites, []);
});

test("V5: a credit-note date that makes an unreferenced return's VAT recoverable is financial — refused", { skip: moduleMocksUnavailable }, async () => {
  useStoredReturn(vatReturn({}));
  txOverrides = { ...txOverrides, siteContent: { findUnique: async () => ({ value: "2026-08-01" }) } };
  const { updatePurchaseReturn } = await import("../actions");
  assertRejectedWithoutWrites(await updatePurchaseReturn("pr1", vatReturnForm({ taxInvoiceDate: "2026-08-20" })));
});

test("V3: a referenced return inherits the purchase's recoverability — its own credit-note date never flips it", { skip: moduleMocksUnavailable }, async () => {
  const purchaseVat = { vatType: "EXCLUDING_VAT", vatRate: 7, taxInvoiceDate: parseDateOnlyToDate("2026-07-15") };
  useStoredReturn(vatReturn({ purchaseId: "po1", purchase: purchaseVat }));
  txOverrides = {
    ...txOverrides,
    siteContent: { findUnique: async () => ({ value: "2026-08-01" }) },
    purchase: {
      findUnique: async () => ({ id: "po1", status: "ACTIVE", supplierId: "sup-1", purchaseNo: "RR26070001", ...purchaseVat }),
    },
  };
  const { updatePurchaseReturn } = await import("../actions");
  const result = await updatePurchaseReturn("pr1", vatReturnForm({ purchaseId: "po1", taxInvoiceDate: "2026-08-20" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchaseReturn.update"]);
  assert.deepEqual(sideWrites, []);
});
