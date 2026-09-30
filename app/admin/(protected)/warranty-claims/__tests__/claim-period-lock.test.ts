import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { PERIOD_LOCK_REASON_FIELD } from "@/lib/period-lock-view";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Month lock on warranty claims (owner decision T2 / ก1), for the steps that write stock:
// - forward steps (open / send / close / return to customer) post new rows on the chosen date,
//   like a new document: refused in a distributed month, no override;
// - reopen and cancel reverse posted rows: refused, unless an admin with period_lock.override
//   gives a reason (audited + alerted).
// Editing the claim's text (symptom, note, supplier contact) is not locked.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const AUG = parseDateOnlyToDate("2026-08-20");

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") {
          return async (query: unknown) => {
            calls.push({ method: modelName, args: query });
            return modelName === "$queryRaw" ? [] : 0;
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
let claimRow: Record<string, unknown> = {};

const onsiteWarranty = {
  id: "w1",
  productId: "p-1",
  lotNo: null,
  status: "ACTIVE",
  createdVia: "MANUAL",
  saleId: null,
  unitSeq: 1,
  endDate: parseDateOnlyToDate("2027-12-31"),
  product: { name: "แบตเตอรี่", inventoryTracking: "TRACKED", isLotControl: false },
  saleItem: null,
  claims: [],
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, []),
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
      writeAuditLogTx: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: { ...realErrorReporting, reportCriticalError: async () => undefined },
  });
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", {
    namedExports: {
      ...realClaimStock,
      getOriginalClaimUnitCost: async () => ({ unitCost: 100, lotNo: null }),
      writeClaimStockMovement: async () => {
        sideWrites.push("claimStock.write");
      },
      reverseClaimStockMovements: async () => {
        sideWrites.push("claimStock.reverse");
      },
    },
  });
  const realLot = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLot,
      reverseClaimLotBalance: async () => {
        sideWrites.push("lot.reverse");
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
    },
  });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", {
    namedExports: { ...realDocNumber, generateClaimNo: async () => "WCM26080002" },
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
  sessionPermissions = ["warranty_claims.create", "warranty_claims.update"];
  claimRow = {
    id: "c1",
    claimNo: "WCM26080001",
    status: "CLOSED",
    outcome: "RECEIVED",
    claimType: "CUSTOMER_WAIT",
    symptom: null,
    supplierName: null,
    claimDate: AUG,
    sentAt: AUG,
    resolvedAt: AUG,
    returnedAt: null,
    warranty: onsiteWarranty,
  };
  dbOverrides = {
    warranty: { findUnique: async () => onsiteWarranty },
    warrantyClaim: { findUnique: async () => claimRow },
  };
  txOverrides = {
    warranty: { findUnique: async () => ({ status: "ACTIVE", claims: [] }) },
    user: { findUnique: async () => ({ name: "Tester", signatureUrl: null }) },
    profitDistribution: {
      findMany: async (args: unknown) => {
        const keys = (args as { where: { activePeriodKey: { in: string[] } } }).where.activePeriodKey.in;
        return keys.filter((key) => declaredPeriods[key]).map((key) => ({ activePeriodKey: key, distributionNo: declaredPeriods[key] }));
      },
    },
  };
});

const REASON = "ซัพพลายเออร์ส่งของผิดรุ่น ต้องย้อนสถานะ";

const assertRejectedWithoutWrites = (result: { error?: string }) => {
  assert.ok(result.error?.includes("PD2026080001"), result.error);
  assert.deepEqual(txCalls.filter((call) => WRITE_METHOD.test(call.method)), []);
  assert.deepEqual(sideWrites, []);
  assert.equal(alerts.length, 0);
};

test("createClaim and the forward steps refuse a date in a distributed month, even for an admin", { skip: moduleMocksUnavailable }, async () => {
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  const { createClaim, sendClaimToSupplier, closeClaim, returnClaimToCustomer } = await import("../actions");

  const form = new FormData();
  form.set("warrantyId", "w1");
  form.set("claimDate", "2026-08-20");
  form.set("claimType", "CUSTOMER_WAIT");
  const created = await createClaim(form);
  assertRejectedWithoutWrites(created);
  assert.ok(!created.error?.includes("ปลดล็อก"), "no override on a new posting");

  claimRow = { ...claimRow, status: "DRAFT", outcome: null, resolvedAt: null, sentAt: null };
  assertRejectedWithoutWrites(await sendClaimToSupplier("c1", "2026-08-25"));

  claimRow = { ...claimRow, status: "SENT_TO_SUPPLIER", sentAt: AUG };
  assertRejectedWithoutWrites(await closeClaim("c1", "RECEIVED", "2026-08-25"));

  claimRow = { ...claimRow, status: "CLOSED", outcome: "RECEIVED", resolvedAt: AUG };
  assertRejectedWithoutWrites(await returnClaimToCustomer("c1", "2026-08-26"));
});

test("a forward step dated in an open month still works on a claim opened in a distributed month", { skip: moduleMocksUnavailable }, async () => {
  const { sendClaimToSupplier } = await import("../actions");
  claimRow = { ...claimRow, status: "DRAFT", outcome: null, resolvedAt: null, sentAt: null };
  assert.deepEqual(await sendClaimToSupplier("c1", "2026-09-05"), {});
  assert.ok(sideWrites.includes("claimStock.write"));
});

test("reopenClaim: the close being reversed is in a distributed month — reason + permission required", { skip: moduleMocksUnavailable }, async () => {
  const { reopenClaim } = await import("../actions");
  assertRejectedWithoutWrites(await reopenClaim("c1", REASON));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await reopenClaim("c1"));
  assert.deepEqual(await reopenClaim("c1", REASON), {});
  assert.ok(sideWrites.includes("claimStock.reverse"));
  assert.equal((audits[0]?.meta as { periodLockOverride?: { reason: string } }).periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].action, "ย้อนสถานะใบเคลม");
});

test("reopenClaim: a close dated in an open month reopens as before", { skip: moduleMocksUnavailable }, async () => {
  claimRow = { ...claimRow, resolvedAt: parseDateOnlyToDate("2026-09-03") };
  const { reopenClaim } = await import("../actions");
  assert.deepEqual(await reopenClaim("c1"), {});
  assert.equal(alerts.length, 0);
});

test("cancelClaim: any posting in a distributed month blocks; an admin with a reason cancels and is alerted", { skip: moduleMocksUnavailable }, async () => {
  const { cancelClaimAction } = await import("../actions");
  const form = (reason?: string) => {
    const data = new FormData();
    data.set("claimId", "c1");
    data.set("cancelNote", "ลูกค้ายกเลิก");
    if (reason !== undefined) data.set(PERIOD_LOCK_REASON_FIELD, reason);
    return data;
  };
  assertRejectedWithoutWrites(await cancelClaimAction(form(REASON)));
  sessionPermissions = [...sessionPermissions, PERIOD_LOCK_OVERRIDE_PERMISSION];
  assertRejectedWithoutWrites(await cancelClaimAction(form("")));
  assert.deepEqual(await cancelClaimAction(form(REASON)), { success: true, deleted: false });
  const meta = audits[0]?.meta as { cancelNote: string; periodLockOverride?: { reason: string } };
  assert.equal(meta.cancelNote, "ลูกค้ายกเลิก");
  assert.equal(meta.periodLockOverride?.reason, REASON);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].docNo, "WCM26080001");
});

test("updateClaim (symptom / note / supplier contact) is not locked", { skip: moduleMocksUnavailable }, async () => {
  // Text edits are open while the claim is still in progress (DRAFT / SENT_TO_SUPPLIER).
  claimRow = { ...claimRow, status: "SENT_TO_SUPPLIER", outcome: null, resolvedAt: null };
  const { updateClaim } = await import("../actions");
  const form = new FormData();
  form.set("note", "โทรตามซัพพลายเออร์แล้ว");
  const result = await updateClaim("c1", form);
  assert.equal(result.error, undefined);
  assert.equal(txCalls.some((call) => call.method === "profitDistribution.findMany"), false);
});
