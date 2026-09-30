import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";

// Month lock on sales (owner decisions T2 / ก1 / ก2): a sale dated in a month whose profit was
// distributed cannot be created, changed or cancelled — except text-only edits (note, customer
// display text, delivery info, the customer on a settled sale) — unless an admin holding
// period_lock.override gives a reason, which is audited and alerted. The check runs inside the
// transaction after the Sale row lock and before any write.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return [];
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
const txWrites = (calls: Call[]) => calls.filter((call) => WRITE_METHOD.test(call.method));

const SALE_UPDATED_AT = new Date("2026-08-21T03:00:00.000Z");
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];
let declaredPeriods: Record<string, string> = {};
let sessionPermissions: string[] = [];
const audits: Array<Record<string, unknown>> = [];
const alerts: Array<Record<string, unknown>> = [];
const criticalReports: unknown[] = [];
const profitRebuilds: string[] = [];
// Stock, receivable, payment and WHT side effects the mocked helpers would have written.
const sideEffects: string[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, dbCalls),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", {
    namedExports: {
      ...realNotifications,
      dispatchOutOfStockAlerts: async () => undefined,
      findProductIdsWithStock: async () => [],
      safeNotifyPeriodLockOverride: async (input: Record<string, unknown>) => {
        alerts.push(input);
      },
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({
        user: { id: "user-1", name: "เจ้าของร้าน", role: "ADMIN", permissions: sessionPermissions },
      }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async (input: Record<string, unknown>) => {
        audits.push(input);
      },
      writeAuditLogTx: async () => undefined,
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
      recalculateStockCard: async () => {
        sideEffects.push("stockCard.recalculate");
      },
      writeStockCard: async () => {
        sideEffects.push("stockCard.write");
        return "stock-card-id";
      },
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async () => {
        sideEffects.push("cashBank.replace");
      },
    },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: {
      ...realPayments,
      clearDocumentPayments: async () => undefined,
      replaceDocumentPayments: async () => {
        sideEffects.push("payments.replace");
      },
    },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: {
      ...realAmountRemain,
      recalculateSaleAmountRemain: async () => {
        sideEffects.push("amountRemain");
      },
    },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: {
      ...realWhtReceived,
      cancelWhtReceivedForDocument: async () => undefined,
      persistWhtReceived: async () => {
        sideEffects.push("wht.persist");
      },
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: {
      ...realProfitFact,
      rebuildSaleProfitFacts: async (_tx: unknown, saleId: string) => {
        profitRebuilds.push(saleId);
      },
    },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

const storedItem = {
  id: "item-1",
  productId: "prod-1",
  quantity: 1,
  salePrice: 100,
  unitListPrice: 100,
  warrantyDays: 0,
  supplierId: null,
  supplierName: null,
  moreDetail: null,
  showQty: 1,
  showUnitName: "ชิ้น",
  product: { name: "ไส้กรอง" },
  lotItems: [] as Array<{ lotNo: string; qty: number }>,
};

type SaleShape = { paymentType: "CASH_SALE" | "CREDIT_SALE"; amountRemain: number };

const existingSale = ({ paymentType, amountRemain }: SaleShape) => ({
  id: "sale1",
  saleNo: "SAC2608200001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-08-19T17:00:00.000Z"), // 2026-08-20 in Thailand
  customerId: "cust-1",
  customerName: null,
  customerPhone: null,
  quotationId: null,
  quotationRevision: null,
  updatedAt: SALE_UPDATED_AT,
  saleType: "RETAIL",
  paymentType,
  fulfillmentType: "PICKUP",
  shippingMethod: "NONE",
  shippingFee: null,
  discount: 0,
  vatType: "NO_VAT",
  vatRate: 0,
  creditTerm: null,
  channelRefNo: null,
  amountRemain,
  netAmount: 100,
  cashBankAccountId: paymentType === "CASH_SALE" ? "cash-1" : null,
  trackingToken: null,
  signerName: "Tester",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Tester", signatureUrl: null },
  items: [storedItem],
  creditNotes: [],
  receipts: [],
  warranties: [],
});

const line = { productId: "prod-1", unitName: "ชิ้น", qty: 1, salePrice: 100, unitListPrice: 100, lineDiscount: 0, warrantyDays: 0, lotItems: [] };

const saleForm = (overrides: Record<string, string> = {}, items: unknown[] = [line]): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-08-20",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

const useSale = (shape: SaleShape) => {
  dbOverrides.sale = { findUnique: async () => existingSale(shape) };
};

const REASON = "ลูกค้าแจ้งราคาผิด ต้องแก้ตามใบกำกับ";

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  audits.length = 0;
  alerts.length = 0;
  criticalReports.length = 0;
  profitRebuilds.length = 0;
  sideEffects.length = 0;
  declaredPeriods = { "2026-08": "PD2026080001" };
  sessionPermissions = ["sales.update", "sales.cancel", "sales.create"];
  const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }] };
  const product = {
    id: "prod-1",
    avgCost: 50,
    costPrice: 50,
    salePrice: 100,
    retailPrice: 100,
    memberPrice: 100,
    inventoryTracking: "TRACKED",
    isLotControl: false,
  };
  dbOverrides = {
    sale: { findUnique: async () => existingSale({ paymentType: "CREDIT_SALE", amountRemain: 100 }) },
    productUnit: units,
    product: { findMany: async () => [] },
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    productUnit: units,
    product: { findMany: async () => [product] },
    stockCard: {
      findMany: async (args: unknown) => ((args as { distinct?: unknown }).distinct ? [{ productId: "prod-1" }] : []),
    },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const assertLockedRejection = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.ok(result.error?.includes("ลงวันที่ปัจจุบัน"));
  assert.deepEqual(txWrites(txCalls), [], "nothing is written");
  assert.equal(criticalReports.length, 0, "a lock is not a system failure");
  assert.equal(alerts.length, 0);
};

test("updateSale: a price change in a distributed month is rejected before any write", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  const result = await updateSale("sale1", saleForm({}, [{ ...line, salePrice: 90, unitListPrice: 90 }]));
  assertLockedRejection(result);
  // The shared lock is taken after the Sale row lock.
  const rowLock = txCalls.findIndex((call) => call.method === "$queryRaw" && /"Sale"/.test((call.args as { sql: string }).sql));
  const periodLock = txCalls.findIndex(
    (call) => call.method === "$executeRaw" && String((call.args as { values: unknown[] }).values[0]).startsWith("period-lock:"),
  );
  assert.ok(rowLock >= 0 && periodLock > rowLock, "month lock after the Sale row lock");
});

test("updateSale: moving the sale OUT of a distributed month is rejected too", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  assertLockedRejection(await updateSale("sale1", saleForm({ saleDate: "2026-09-02" })));
});

test("updateSale: a note / name / address edit in a distributed month writes only those fields", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  const result = await updateSale(
    "sale1",
    saleForm({ note: "โทรนัดก่อนส่ง", customerName: "คุณสมชาย", customerPhone: "0812345678" }),
  );
  assert.deepEqual(result, { success: true });
  const writes = txWrites(txCalls);
  assert.deepEqual(writes.map((call) => call.method), ["sale.update"]);
  const data = (writes[0].args as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data).sort(), [
    "customerId", "customerName", "customerPhone", "destLatitude", "destLongitude", "note", "shippingAddress",
  ]);
  assert.equal(data.note, "โทรนัดก่อนส่ง");
  assert.deepEqual(profitRebuilds, [], "profit facts untouched");
  assert.equal(alerts.length, 0, "no override was needed");
});

test("updateSale: the customer may change on a cash sale but not on an unpaid credit sale", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  useSale({ paymentType: "CASH_SALE", amountRemain: 0 });
  // The stored receiving row, compared with the submitted one (same account and amount).
  txOverrides.documentPayment = { findMany: async () => [{ cashBankAccountId: "cash-1", amount: 100 }] };
  const cashPayments = JSON.stringify([{ cashBankAccountId: "cash-1", amount: 100 }]);
  const cashCustomer = await updateSale(
    "sale1",
    saleForm({ customerId: "cust-2", paymentType: "CASH_SALE", payments: cashPayments }),
  );
  assert.deepEqual(cashCustomer, { success: true });
  assert.deepEqual(txWrites(txCalls).map((call) => call.method), ["sale.update"]);
  assert.equal((txWrites(txCalls)[0].args as { data: { customerId: string } }).data.customerId, "cust-2");

  txCalls.length = 0;
  useSale({ paymentType: "CREDIT_SALE", amountRemain: 100 });
  assertLockedRejection(await updateSale("sale1", saleForm({ customerId: "cust-2" })));
});

test("updateSale: a fully paid credit sale may change customer (no receipt guard in the fake)", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  useSale({ paymentType: "CREDIT_SALE", amountRemain: 0 });
  const result = await updateSale("sale1", saleForm({ customerId: "cust-2" }));
  assert.deepEqual(result, { success: true });
  assert.deepEqual(txWrites(txCalls).map((call) => call.method), ["sale.update"]);
});

test("updateSale (P3): an override holder's note-only edit needs no reason", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const result = await updateSale("sale1", saleForm({ note: "ลูกค้ารับของแล้ว" }));
  assert.deepEqual(result, { success: true });
  assert.deepEqual(txWrites(txCalls).map((call) => call.method), ["sale.update"]);
  assert.deepEqual(profitRebuilds, []);
  assert.deepEqual(sideEffects, []);
  assert.equal(alerts.length, 0, "no override was used");
  assert.ok(audits.every((entry) => !(entry.meta as { periodLockOverride?: unknown } | undefined)?.periodLockOverride));
});

test("updateSale (P3): an override holder's financial edit without any reason is rejected", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const result = await updateSale("sale1", saleForm({}, [{ ...line, salePrice: 90, unitListPrice: 90 }]));
  assertLockedRejection(result);
  assert.ok(result.error?.includes("เหตุผล"), result.error);
});

test("updateSale (P4): a line-detail edit saves only that remark — no stock, receivable or facts", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  const result = await updateSale("sale1", saleForm({}, [{ ...line, moreDetail: "สีดำ รุ่นปี 2020" }]));
  assert.deepEqual(result, { success: true });
  const writes = txWrites(txCalls);
  assert.deepEqual(writes.map((call) => call.method), ["sale.update", "saleItem.update"]);
  assert.deepEqual(writes[1].args, { where: { id: "item-1" }, data: { moreDetail: "สีดำ รุ่นปี 2020" } });
  assert.deepEqual(profitRebuilds, [], "profit facts untouched");
  assert.deepEqual(sideEffects, [], "no stock card, receivable, payment or WHT write");
  assert.equal(alerts.length, 0);
});

test("updateSale (P4): fulfilment type and carrier stay financial", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  assertLockedRejection(
    await updateSale("sale1", saleForm({ fulfillmentType: "DELIVERY", shippingAddress: "99 ถ.สุขุมวิท", shippingMethod: "FLASH" })),
  );
  assert.deepEqual(sideEffects, []);
});

test("updateSale: override needs the permission AND a reason", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  const priceChange = (reason: string) =>
    saleForm({ [PERIOD_LOCK_REASON_FIELD]: reason }, [{ ...line, salePrice: 90, unitListPrice: 90 }]);

  assertLockedRejection(await updateSale("sale1", priceChange(REASON)));

  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const emptyReason = await updateSale("sale1", priceChange("  "));
  assertLockedRejection(emptyReason);
  assert.ok(emptyReason.error?.includes("เหตุผล"));
});

test("updateSale: an admin override with a reason saves, audits the reason and alerts", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const result = await updateSale(
    "sale1",
    saleForm({ [PERIOD_LOCK_REASON_FIELD]: REASON }, [{ ...line, salePrice: 90, unitListPrice: 90 }]),
  );
  assert.deepEqual(result, { success: true });
  assert.deepEqual(profitRebuilds, ["sale1"], "the full edit ran");
  const audit = audits.find((entry) => entry.entityType === "Sale" && entry.action === "UPDATE");
  const meta = audit?.meta as { periodLockOverride?: { reason: string; periods: Array<{ distributionNo: string }> } };
  assert.equal(meta?.periodLockOverride?.reason, REASON);
  assert.equal(meta?.periodLockOverride?.periods[0].distributionNo, "PD2026080001");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "SAC2608200001");
  assert.equal(alerts[0].reason, REASON);
  assert.equal(alerts[0].link, "/admin/sales/sale1");
});

test("updateSale / cancelSale in an open month behave as before", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { updateSale, cancelSale } = await import("../actions");
  assert.deepEqual(await updateSale("sale1", saleForm({}, [{ ...line, salePrice: 90, unitListPrice: 90 }])), { success: true });
  const form = new FormData();
  form.set("saleId", "sale1");
  assert.deepEqual(await cancelSale(form), { success: true });
  assert.equal(alerts.length, 0);
  assert.ok(audits.every((entry) => !(entry.meta as { periodLockOverride?: unknown } | undefined)?.periodLockOverride));
});

test("cancelSale: rejected in a distributed month; an admin with a reason may cancel", { skip: moduleMocksUnavailable }, async () => {
  const { cancelSale } = await import("../actions");
  const form = new FormData();
  form.set("saleId", "sale1");
  form.set(PERIOD_LOCK_REASON_FIELD, REASON);
  assertLockedRejection(await cancelSale(form));

  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  txCalls.length = 0;
  assert.deepEqual(await cancelSale(form), { success: true });
  const audit = audits.find((entry) => entry.action === "CANCEL");
  assert.equal((audit?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].action, "ยกเลิกใบขาย");
});

test("createSale: a new sale dated in a distributed month is refused before any write", { skip: moduleMocksUnavailable }, async () => {
  const { createSale } = await import("../actions");
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const result = await createSale(saleForm({ [PERIOD_LOCK_REASON_FIELD]: REASON }));
  assertLockedRejection(result);
  assert.ok(!result.error?.includes("ปลดล็อก"), "no override is offered on create");
});
