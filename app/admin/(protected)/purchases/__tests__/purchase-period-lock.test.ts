import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on purchases (owner decisions T2 / ก1 / ก2): a purchase dated in a month whose profit
// was distributed cannot be created, changed or cancelled — a note-only edit stays free — unless an
// admin with period_lock.override gives a reason (audited + alerted). Checked under the Purchase
// row lock (and product locks), before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const PURCHASE_DATE = parseDateOnlyToDate("2026-08-20");

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

const storedPurchase = {
  id: "pur1",
  purchaseNo: "RRC26080001",
  purchaseDate: PURCHASE_DATE,
  status: "ACTIVE",
  supplierId: "sup-1",
  supplier: null,
  purchaseType: "CREDIT_PURCHASE",
  discount: 0,
  shippingFee: 0,
  vatType: "NO_VAT",
  vatRate: 0,
  creditTerm: 30,
  note: null,
  items: [
    {
      id: "pi-1",
      lineNo: 1,
      productId: "p-1",
      quantity: 2,
      costPrice: 50,
      landedCost: 0,
      showQty: 2,
      showUnitName: "ชิ้น",
      moreDetail: null,
      lotItems: [],
      product: { code: "P1", name: "ไส้กรอง" },
    },
  ],
  purchaseReturns: [],
  supplierPaymentItems: [],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => [{ status: "ACTIVE", purchaseDate: PURCHASE_DATE }]);
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
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        sideWrites.push("stockCard.write");
        return "stock-card-id";
      },
      recalculateStockCardMany: async () => {
        sideWrites.push("stockCard.recalculate");
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
  const realPurchaseLast = await import("@/lib/product-purchase-last");
  await mock.module("@/lib/product-purchase-last", {
    namedExports: { ...realPurchaseLast, refreshProductPurchaseLastFields: async () => undefined },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generatePurchaseNo: async () => "RRC26080002" },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

beforeEach(() => {
  txCalls.length = 0;
  sideWrites.length = 0;
  audits.length = 0;
  alerts.length = 0;
  criticalReports.length = 0;
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = ["purchases.update", "purchases.cancel", "purchases.create"];
  const units = { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] };
  dbOverrides = { purchase: { findUnique: async () => storedPurchase }, productUnit: units };
  txOverrides = {
    productUnit: units,
    stockCard: { groupBy: async () => [] },
    product: {
      findMany: async () => [{ id: "p-1", isLotControl: false, requireExpiryDate: false, inventoryTracking: "TRACKED" }],
    },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const purchaseForm = (overrides: Record<string, string> = {}, costPrice = 50) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1",
    purchaseDate: "2026-08-20",
    purchaseType: "CREDIT_PURCHASE",
    vatType: "NO_VAT",
    vatRate: "0",
    creditTerm: "30",
    items: JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 2, costPrice }]),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const cancelForm = (reason?: string) => {
  const form = new FormData();
  form.set("purchaseId", "pur1");
  if (reason !== undefined) form.set(PERIOD_LOCK_REASON_FIELD, reason);
  return form;
};

const REASON = "ผู้ขายออกใบกำกับแก้ราคาทุน";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(criticalReports.length, 0);
  assert.equal(alerts.length, 0);
};

test("createPurchase in a distributed month is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchase } = await import("../actions");
  assertRejectedWithoutWrites(await createPurchase(purchaseForm()));
});

test("updatePurchase: a cost change in a distributed month is rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");
  assertRejectedWithoutWrites(await updatePurchase("pur1", purchaseForm({}, 45)));
});

test("updatePurchase: a note-only edit in a distributed month writes the header remarks only", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");
  const result = await updatePurchase("pur1", purchaseForm({ note: "รอใบกำกับตัวจริง" }));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchase.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, {
    note: "รอใบกำกับตัวจริง", referenceNo: null, taxInvoiceNo: null, taxInvoiceDate: null,
  });
  assert.deepEqual(sideWrites, []);
});

test("updatePurchase (P4): the reference number and line detail save as remarks — no stock, payable or payments", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");
  const form = purchaseForm({ referenceNo: "INV-2026-0815" });
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 2, costPrice: 50, moreDetail: "ล็อตสีดำ" }]));
  const result = await updatePurchase("pur1", form);
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchase.update", "purchaseItem.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, {
    note: null, referenceNo: "INV-2026-0815", taxInvoiceNo: null, taxInvoiceDate: null,
  });
  assert.deepEqual(writes[1].args, { where: { id: "pi-1" }, data: { moreDetail: "ล็อตสีดำ" } });
  assert.deepEqual(sideWrites, [], "no stock card, payment or cash/bank write");
  assert.equal(alerts.length, 0);
});

test("updatePurchase: an admin override with a reason runs the full edit, audits and alerts", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("pur1", purchaseForm({ [PERIOD_LOCK_REASON_FIELD]: REASON }, 45)), { success: true });
  assert.ok(sideWrites.includes("payments.replace"), "the full edit ran");
  assert.ok(txCalls.some((call) => call.method === "purchaseItem.createMany" || call.method === "purchaseItem.create"));
  const audit = audits.find((entry) => entry.action === "UPDATE");
  assert.equal((audit?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "RRC26080001");
});

test("cancelPurchase: blocked without permission / reason, allowed with both", { skip: moduleMocksUnavailable }, async () => {
  const { cancelPurchase } = await import("../actions");
  assertRejectedWithoutWrites(await cancelPurchase(cancelForm(REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelPurchase(cancelForm("")));
  assert.deepEqual(await cancelPurchase(cancelForm(REASON)), { success: true });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].action, "ยกเลิกใบรับสินค้า");
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { updatePurchase, cancelPurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("pur1", purchaseForm({}, 45)), { success: true });
  assert.deepEqual(await cancelPurchase(cancelForm()), { success: true });
  assert.equal(alerts.length, 0);
});

// ── V5: the tax invoice number/date are remarks unless the date flips VAT recoverability ──

const vatPurchase = (taxInvoiceNo: string | null, taxInvoiceDate: Date | null) => ({
  ...storedPurchase,
  vatType: "INCLUDING_VAT",
  vatRate: 7,
  taxInvoiceNo,
  taxInvoiceDate,
});

const vatPurchaseForm = (taxInvoiceNo: string, taxInvoiceDate: string) =>
  purchaseForm({ vatType: "INCLUDING_VAT", vatRate: "7", taxInvoiceNo, taxInvoiceDate });

test("V5: adding the tax invoice number/date in a distributed month is a remark while recoverability is unchanged", { skip: moduleMocksUnavailable }, async () => {
  // Not VAT-registered (no vat_registered_from row): the VAT stays cost whatever the date.
  dbOverrides = { ...dbOverrides, purchase: { findUnique: async () => vatPurchase(null, null) } };
  const { updatePurchase } = await import("../actions");
  const result = await updatePurchase("pur1", vatPurchaseForm("IV-0815", "2026-08-20"));
  assert.deepEqual(result, { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchase.update"]);
  assert.deepEqual((writes[0].args as { data: unknown }).data, {
    note: null, referenceNo: null, taxInvoiceNo: "IV-0815", taxInvoiceDate: parseDateOnlyToDate("2026-08-20"),
  });
  assert.deepEqual(sideWrites, []);
});

test("V5: a tax invoice date that makes the VAT recoverable is financial — refused in a distributed month", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides = {
    ...dbOverrides,
    siteContent: { findUnique: async () => ({ value: "2026-08-01" }) },
    purchase: { findUnique: async () => vatPurchase("IV-0815", parseDateOnlyToDate("2026-07-31")) },
  };
  const { updatePurchase } = await import("../actions");
  assertRejectedWithoutWrites(await updatePurchase("pur1", vatPurchaseForm("IV-0815", "2026-08-20")));
});

test("V5: moving the tax invoice date inside the recoverable range stays a remark", { skip: moduleMocksUnavailable }, async () => {
  dbOverrides = {
    ...dbOverrides,
    siteContent: { findUnique: async () => ({ value: "2026-08-01" }) },
    purchase: { findUnique: async () => vatPurchase("IV-0815", parseDateOnlyToDate("2026-08-19")) },
  };
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("pur1", vatPurchaseForm("IV-0815", "2026-08-20")), { success: true });
  const writes = txCalls.filter((call) => WRITE_METHOD.test(call.method));
  assert.deepEqual(writes.map((call) => call.method), ["purchase.update"]);
  assert.deepEqual(sideWrites, []);
});
