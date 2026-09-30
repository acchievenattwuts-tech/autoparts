import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on stock adjustments and balance-forward documents (owner decision T2 / ก1): one
// dated in a month whose profit was distributed cannot be created or cancelled, unless an admin
// with period_lock.override cancels it with a reason (audited + alerted). No override on create.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const DOC_DATE = parseDateOnlyToDate("2026-08-20");

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
                return { id: `${modelName}-id`, count: 1 };
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

const storedAdjustment = {
  id: "adj1",
  adjustNo: "ADJ26080001",
  adjustDate: DOC_DATE,
  status: "ACTIVE",
  note: null,
  cancelNote: null,
  cancelledAt: null,
  updatedAt: DOC_DATE,
  user: { name: "Tester", email: null },
  items: [{ id: "ai-1", productId: "p-1", qtyAdjust: 1, reason: null, product: { code: "P1", name: "ไส้กรอง" } }],
};

const storedBf = {
  id: "bf1",
  docNo: "BF26080001",
  docDate: DOC_DATE,
  status: "ACTIVE",
  productId: "p-1",
  unitName: "ชิ้น",
  qtyInBase: 5,
  costPerBaseUnit: 10,
  note: null,
  cancelNote: null,
  cancelledAt: null,
  product: { code: "P1", name: "ไส้กรอง" },
  user: { name: "Tester", email: null },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => [{ id: "row", adjustDate: DOC_DATE, docDate: DOC_DATE }]);
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
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        sideWrites.push("stockCard.write");
        return "stock-card-id";
      },
      recalculateStockCard: async () => {
        sideWrites.push("stockCard.recalculate");
      },
      recalculateStockCardMany: async () => {
        sideWrites.push("stockCard.recalculate");
      },
    },
  });
  const realLot = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLot,
      reverseAdjustmentLotBalance: async () => {
        sideWrites.push("lot.reverse");
      },
      reverseBalanceForwardLotBalance: async () => {
        sideWrites.push("lot.reverse");
      },
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateAdjNo: async () => "ADJ26080002", generateBFNo: async () => "BF26080002" },
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
  sessionPermissions = ["stock.adjustments.create", "stock.adjustments.cancel", "stock.bf.create", "stock.bf.cancel"];
  dbOverrides = {
    adjustment: { findUnique: async () => storedAdjustment },
    balanceForward: { findUnique: async () => storedBf },
    productUnit: { findUnique: async () => ({ productId: "p-1", name: "ชิ้น", scale: 1 }) },
    product: { findUnique: async () => ({ inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false }) },
  };
  txOverrides = {
    adjustment: {
      create: async () => ({ id: "adj2", items: [{ id: "ai-2", productId: "p-1", qtyAdjust: 1, reason: null }] }),
    },
    productUnit: { findMany: async () => [{ productId: "p-1", name: "ชิ้น", scale: 1 }] },
    product: {
      findMany: async () => [{ id: "p-1", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false, avgCost: 10 }],
    },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const REASON = "นับสต็อกผิด ต้องยกเลิกเอกสารเดิม";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(alerts.length, 0);
};

const adjustmentForm = () => {
  const form = new FormData();
  form.set("adjustDate", "2026-08-20");
  form.set("items", JSON.stringify([{ productId: "p-1", unitName: "ชิ้น", qty: 1, price: 10, type: "ADJUST_IN" }]));
  return form;
};

const bfForm = () => {
  const form = new FormData();
  form.set("productId", "p-1");
  form.set("unitName", "ชิ้น");
  form.set("qty", "5");
  form.set("costPerBaseUnit", "10");
  form.set("docDate", "2026-08-20");
  return form;
};

const cancelForm = (idField: string, id: string, reason?: string) => {
  const form = new FormData();
  form.set(idField, id);
  if (reason !== undefined) form.set(PERIOD_LOCK_REASON_FIELD, reason);
  return form;
};

test("createAdjustment / createBF in a distributed month are refused before any write, with no override", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { createAdjustment } = await import("../actions");
  const { createBF } = await import("../../bf/actions");
  const adjustment = await createAdjustment(adjustmentForm());
  assertRejectedWithoutWrites(adjustment);
  assert.ok(!adjustment.error?.includes("ปลดล็อก"));
  assertRejectedWithoutWrites(await createBF(bfForm()));
});

test("cancelAdjustment: blocked without permission / reason; an admin with a reason cancels and is alerted", { skip: moduleMocksUnavailable }, async () => {
  const { cancelAdjustment } = await import("../actions");
  assertRejectedWithoutWrites(await cancelAdjustment(cancelForm("adjustmentId", "adj1", REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelAdjustment(cancelForm("adjustmentId", "adj1", "")));
  assert.deepEqual(await cancelAdjustment(cancelForm("adjustmentId", "adj1", REASON)), { success: true });
  assert.ok(sideWrites.includes("stockCard.recalculate"));
  assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "ADJ26080001");
});

test("cancelBF: blocked without permission / reason; an admin with a reason cancels and is alerted", { skip: moduleMocksUnavailable }, async () => {
  const { cancelBF } = await import("../../bf/actions");
  assertRejectedWithoutWrites(await cancelBF(cancelForm("bfId", "bf1", REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelBF(cancelForm("bfId", "bf1", " ")));
  assert.deepEqual(await cancelBF(cancelForm("bfId", "bf1", REASON)), { success: true });
  assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].entityType, "BalanceForward");
});

test("an open month is unaffected", { skip: moduleMocksUnavailable }, async () => {
  declaredPeriods = {};
  const { createAdjustment, cancelAdjustment } = await import("../actions");
  const { createBF, cancelBF } = await import("../../bf/actions");
  assert.equal((await createAdjustment(adjustmentForm())).success, true);
  assert.equal((await createBF(bfForm())).success, true);
  assert.deepEqual(await cancelAdjustment(cancelForm("adjustmentId", "adj1")), { success: true });
  assert.deepEqual(await cancelBF(cancelForm("bfId", "bf1")), { success: true });
  assert.equal(alerts.length, 0);
});
