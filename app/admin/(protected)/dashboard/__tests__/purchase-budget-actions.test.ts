import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import type { PurchaseBudgetSettings } from "@/lib/purchase-budget-core";

// updatePurchaseBudgetCap: permission gate, validation, SiteContent writes and the AuditLog entry.
// DB, auth, audit and the alert check are module-mocked — nothing here touches a real database.

type AuditCall = { action: string; entityType: string; before: unknown; after: unknown; meta: unknown };

let allowed = true;
let currentSettings: PurchaseBudgetSettings = { cap: null, thresholdPct: 10, startedOn: null };
let writes: Record<string, string> = {};
let audits: AuditCall[] = [];
let alertChecks = 0;
let revalidated: string[] = [];
let updatePurchaseBudgetCap: typeof import("../purchase-budget-actions").updatePurchaseBudgetCap;

const fakeTx = {
  $executeRaw: async () => 0,
  siteContent: {
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      writes[where.key] = update.value;
    },
  },
};

before(async () => {
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, dbTx: async <T>(fn: (tx: typeof fakeTx) => Promise<T>): Promise<T> => fn(fakeTx) },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async (permission: string) => {
        if (!allowed || permission !== "purchase_budget.manage") throw new Error("FORBIDDEN");
        return { user: { id: "user-1", name: "เจ้าของร้าน", role: "ADMIN", permissions: [permission] } };
      },
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      writeAuditLogTx: async (_tx: unknown, input: AuditCall) => { audits.push(input); },
    },
  });
  const realBudget = await import("@/lib/purchase-budget");
  await mock.module("@/lib/purchase-budget", {
    namedExports: { ...realBudget, getPurchaseBudgetSettings: async () => currentSettings },
  });
  await mock.module("@/lib/purchase-budget-alerts", {
    namedExports: { safeCheckPurchaseBudgetAlert: async () => { alertChecks += 1; } },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", {
    namedExports: { ...realNextCache, revalidatePath: (path: string) => { revalidated.push(path); } },
  });
  const realNextServer = await import("next/server");
  await mock.module("next/server", {
    namedExports: { ...realNextServer, after: (task: () => unknown) => { void task(); } },
  });
  ({ updatePurchaseBudgetCap } = await import("../purchase-budget-actions"));
});

beforeEach(() => {
  allowed = true;
  currentSettings = { cap: null, thresholdPct: 10, startedOn: null };
  writes = {};
  audits = [];
  alertChecks = 0;
  revalidated = [];
});

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("needs purchase_budget.manage", async () => {
  allowed = false;
  const result = await updatePurchaseBudgetCap(form({ mode: "set", amount: "1400000", thresholdPct: "10", reason: "เริ่มใช้งบ" }));
  assert.deepEqual(result, { error: "ไม่มีสิทธิ์ปรับเพดานงบสั่งซื้อ" });
  assert.deepEqual(writes, {});
  assert.equal(audits.length, 0);
});

test("a reason is required and amounts must be positive", async () => {
  assert.deepEqual(
    await updatePurchaseBudgetCap(form({ mode: "set", amount: "1400000", thresholdPct: "10", reason: "  " })),
    { error: "กรุณากรอกเหตุผล" },
  );
  assert.deepEqual(
    await updatePurchaseBudgetCap(form({ mode: "add", amount: "0", thresholdPct: "10", reason: "ทดสอบ" })),
    { error: "จำนวนเงินต้องมากกว่า 0" },
  );
  assert.equal(
    (await updatePurchaseBudgetCap(form({ mode: "add", amount: "1000", thresholdPct: "60", reason: "ทดสอบ" }))).error,
    "เส้นเตือนต้องอยู่ระหว่าง 0–50%",
  );
  assert.deepEqual(writes, {});
});

test("first setup stores cap, warning line and start date, audited as CREATE", async () => {
  const result = await updatePurchaseBudgetCap(form({ mode: "set", amount: "1,400,000", thresholdPct: "10", reason: "เริ่มใช้งบสั่งซื้อ" }));
  assert.deepEqual(result, { success: true, cap: 1_400_000 });
  assert.equal(writes.purchase_budget_cap, "1400000.00");
  assert.equal(writes.purchase_budget_threshold_pct, "10");
  assert.match(writes.purchase_budget_started_on ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "CREATE");
  assert.equal(audits[0].entityType, "PurchaseBudget");
  assert.deepEqual(audits[0].before, { cap: null, thresholdPct: null });
  assert.deepEqual(audits[0].after, { cap: 1_400_000, thresholdPct: 10 });
  assert.deepEqual(revalidated, ["/admin/dashboard"]);
  assert.equal(alertChecks, 1);
});

test("adding to an existing cap is an UPDATE and keeps the start date", async () => {
  currentSettings = { cap: 1_400_000, thresholdPct: 10, startedOn: "2026-10-01" };
  const result = await updatePurchaseBudgetCap(form({ mode: "add", amount: "50000", thresholdPct: "15", reason: "เตรียมสต็อกปลายปี" }));
  assert.deepEqual(result, { success: true, cap: 1_450_000 });
  assert.equal(writes.purchase_budget_cap, "1450000.00");
  assert.equal(writes.purchase_budget_threshold_pct, "15");
  assert.equal(writes.purchase_budget_started_on, undefined);
  assert.equal(audits[0].action, "UPDATE");
  assert.deepEqual(audits[0].before, { cap: 1_400_000, thresholdPct: 10 });
  assert.deepEqual(audits[0].meta, { mode: "add", amount: 50_000, reason: "เตรียมสต็อกปลายปี", startedOn: "2026-10-01" });
});

test("lowering the cap to zero is refused before anything is written", async () => {
  currentSettings = { cap: 100_000, thresholdPct: 10, startedOn: "2026-10-01" };
  const result = await updatePurchaseBudgetCap(form({ mode: "subtract", amount: "100000", thresholdPct: "10", reason: "ทดสอบ" }));
  assert.deepEqual(result, { error: "เพดานใหม่ต้องมากกว่า 0 บาท" });
  assert.deepEqual(writes, {});
  assert.equal(audits.length, 0);
  assert.equal(alertChecks, 0);
});
