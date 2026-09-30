import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on credit notes (owner decisions T2 / ก1 / ก2 / P4): a CN dated in a month whose profit
// was distributed cannot be created, changed or cancelled — the note, the customer display name and
// the line remarks (detail, no-restock reason) stay free — unless an admin with period_lock.override
// gives a reason (audited + alerted).
// The check runs under the CreditNote row lock, before any write.

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
const CN_DATE = parseDateOnlyToDate("2026-08-20");

let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const txCalls: Call[] = [];
const sideWrites: string[] = [];
let declaredPeriods: Record<string, string> = {};
let sessionPermissions: string[] = [];
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];
const criticalReports: unknown[] = [];

const storedCreditNote = {
  id: "cn1",
  cnNo: "CN26080001",
  cnDate: CN_DATE,
  status: "ACTIVE",
  channel: null,
  saleId: null,
  sale: null,
  customerId: "cust-1",
  customer: { code: "C001", name: "ร้านช่างเอ" },
  customerName: "ร้านช่างเอ",
  type: "DISCOUNT",
  settlementType: "CREDIT_DEBT",
  vatType: "NO_VAT",
  vatRate: 0,
  note: null,
  items: [
    {
      id: "cni-1",
      productId: "p-1",
      saleItemId: null,
      stockDisposition: "RESTOCK",
      stockDispositionNote: null,
      qty: 1,
      unitPrice: 100,
      amount: 100,
      subtotalAmount: 100,
      showQty: 1,
      showUnitName: "ชิ้น",
      moreDetail: null,
      product: { code: "P1", name: "ไส้กรอง" },
      lotItems: [],
    },
  ],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => [{ status: "ACTIVE" }]);
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
      notifyMarketplaceReturnRecorded: async () => 0,
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
      recalculateCNAmountRemain: async () => {
        sideWrites.push("amountRemain");
      },
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      ...realProfitFact,
      rebuildCreditNoteProfitFacts: async () => {
        sideWrites.push("profitFacts.rebuild");
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateCNNo: async () => "CN26080002", generateExpenseNo: async () => "OE26080001" },
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
  criticalReports.length = 0;
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = ["credit_notes.update", "credit_notes.cancel", "credit_notes.create"];
  const units = { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] };
  dbOverrides = {
    creditNote: { findUnique: async () => storedCreditNote },
    productUnit: units,
  };
  txOverrides = {
    creditNote: { findUnique: async () => storedCreditNote, findMany: async () => [{ cnNo: "CN26080001" }] },
    productUnit: units,
    product: { findMany: async () => [{ id: "p-1", inventoryTracking: "TRACKED", isLotControl: false }] },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const cnForm = (overrides: Record<string, string> = {}, items?: unknown[]) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    cnDate: "2026-08-20",
    customerId: "cust-1",
    customerName: "ร้านช่างเอ",
    type: "DISCOUNT",
    settlementType: "CREDIT_DEBT",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items ?? [{ productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 100 }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const cancelForm = (reason?: string) => {
  const form = new FormData();
  form.set("cnId", "cn1");
  if (reason !== undefined) form.set(PERIOD_LOCK_REASON_FIELD, reason);
  return form;
};

const REASON = "ลูกค้าคืนของผิดรายการ ต้องแก้ยอด";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(criticalReports.length, 0);
  assert.equal(alerts.length, 0);
};

test("createCreditNote in a distributed month is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createCreditNote } = await import("../actions");
  assertRejectedWithoutWrites(await createCreditNote(cnForm()));
});

test("updateCreditNote: a price change in a distributed month is rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateCreditNote } = await import("../actions");
  assertRejectedWithoutWrites(
    await updateCreditNote("cn1", cnForm({}, [{ productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 90 }])),
  );
});

test("updateCreditNote: a note / customer-name edit in a distributed month writes only those fields", { skip: moduleMocksUnavailable }, async () => {
  const { updateCreditNote } = await import("../actions");
  const result = await updateCreditNote("cn1", cnForm({ note: "ส่งเอกสารแล้ว", customerName: "ร้านช่างเอ (สาขา 2)" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["creditNote.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, { customerName: "ร้านช่างเอ (สาขา 2)", note: "ส่งเอกสารแล้ว" });
  assert.deepEqual(sideWrites, []);
});

test("updateCreditNote (P4): line detail and the no-restock reason save as remarks only", { skip: moduleMocksUnavailable }, async () => {
  const returnCreditNote = {
    ...storedCreditNote,
    type: "RETURN",
    items: [{ ...storedCreditNote.items[0], stockDisposition: "DAMAGED_NO_RESTOCK", stockDispositionNote: "กล่องแตก" }],
  };
  dbOverrides.creditNote = { findUnique: async () => returnCreditNote };
  txOverrides.creditNote = { findUnique: async () => returnCreditNote, findMany: async () => [{ cnNo: "CN26080001" }] };
  const { updateCreditNote } = await import("../actions");
  const result = await updateCreditNote(
    "cn1",
    cnForm({ type: "RETURN" }, [
      {
        productId: "p-1",
        unitName: "ชิ้น",
        qty: 1,
        salePrice: 100,
        stockDisposition: "DAMAGED_NO_RESTOCK",
        stockDispositionNote: "ฝาครอบแตก ลูกค้าส่งรูปยืนยันแล้ว",
        moreDetail: "สีเงิน",
      },
    ]),
  );
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["creditNote.update", "creditNoteItem.update"]);
  assert.deepEqual(writes[1].args, {
    where: { id: "cni-1" },
    data: { moreDetail: "สีเงิน", stockDispositionNote: "ฝาครอบแตก ลูกค้าส่งรูปยืนยันแล้ว" },
  });
  assert.deepEqual(sideWrites, [], "no refund, receivable or profit-fact write");
  assert.equal(alerts.length, 0);
});

test("updateCreditNote: the customer itself is financial in a locked month", { skip: moduleMocksUnavailable }, async () => {
  const { updateCreditNote } = await import("../actions");
  assertRejectedWithoutWrites(await updateCreditNote("cn1", cnForm({ customerId: "cust-2" })));
});

test("updateCreditNote: override with the permission and a reason runs the full edit and alerts", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { updateCreditNote } = await import("../actions");
  const result = await updateCreditNote(
    "cn1",
    cnForm({ [PERIOD_LOCK_REASON_FIELD]: REASON }, [{ productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 90 }]),
  );
  assert.deepEqual(result, { success: true });
  assert.ok(sideWrites.includes("profitFacts.rebuild"));
  const audit = audits.find((entry) => entry.action === "UPDATE");
  assert.equal((audit?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "CN26080001");
});

test("cancelCreditNote: rejected without the permission or with an empty reason; allowed with both", { skip: moduleMocksUnavailable }, async () => {
  const { cancelCreditNote } = await import("../actions");
  assertRejectedWithoutWrites(await cancelCreditNote(cancelForm(REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelCreditNote(cancelForm(" ")));
  assert.deepEqual(await cancelCreditNote(cancelForm(REASON)), { success: true });
  const audit = audits.find((entry) => entry.action === "CANCEL");
  assert.equal((audit?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].action, "ยกเลิกใบลดหนี้");
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { updateCreditNote, cancelCreditNote } = await import("../actions");
  assert.deepEqual(
    await updateCreditNote("cn1", cnForm({}, [{ productId: "p-1", unitName: "ชิ้น", qty: 1, salePrice: 90 }])),
    { success: true },
  );
  assert.deepEqual(await cancelCreditNote(cancelForm()), { success: true });
  assert.equal(alerts.length, 0);
});
