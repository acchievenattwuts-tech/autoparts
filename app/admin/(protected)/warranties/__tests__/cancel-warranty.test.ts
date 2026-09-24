import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// On-site (MANUAL) warranty cancel: the row is kept with status CANCELLED instead of
// being deleted (a delete failed on the claim → warranty foreign key).

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type Row = Record<string, unknown>;

let warranty: Row | null = null;
let openClaimsInTx: Array<{ claimNo: string }> = [];
const calls: string[] = [];
const updates: Row[] = [];
const audits: Row[] = [];

const fakeDb = {
  $queryRaw: async (query: { values?: unknown[] }) => {
    calls.push(`lock:Warranty:${String(query.values?.[0])}`);
    return [];
  },
  warranty: {
    findUnique: async () => warranty,
    update: async ({ data }: { data: Row }) => {
      calls.push("warranty.update");
      updates.push(data);
      return { ...warranty, ...data };
    },
    delete: async () => {
      calls.push("warranty.delete");
      return warranty;
    },
  },
  warrantyClaim: {
    findMany: async () => openClaimsInTx,
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: fakeDb, dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb) },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async (input: Row) => {
        audits.push(input);
      },
    },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  warranty = {
    id: "w-1",
    status: "ACTIVE",
    createdVia: "MANUAL",
    saleId: null,
    saleItemId: null,
    productId: "prod-1",
    customerId: "cust-1",
    customerName: "ลูกค้า",
    warrantyDays: 90,
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: new Date("2026-11-30T00:00:00Z"),
    unitSeq: 1,
    lotNo: null,
    note: null,
    claims: [],
  };
  openClaimsInTx = [];
  calls.length = 0;
  updates.length = 0;
  audits.length = 0;
});

const form = (cancelNote?: string): FormData => {
  const formData = new FormData();
  formData.set("warrantyId", "w-1");
  if (cancelNote !== undefined) formData.set("cancelNote", cancelNote);
  return formData;
};

test("cancelWarranty sets status CANCELLED + cancelledAt + cancelNote and never deletes", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");

  const result = await cancelWarranty(form("  ติดตั้งผิดรุ่น  "));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, ["lock:Warranty:w-1", "warranty.update"]);
  assert.equal(updates[0].status, "CANCELLED");
  assert.ok(updates[0].cancelledAt instanceof Date);
  assert.equal(updates[0].cancelNote, "ติดตั้งผิดรุ่น");
  assert.equal(audits[0].action, "CANCEL");
  assert.equal(audits[0].entityType, "Warranty");
  assert.deepEqual(audits[0].meta, { cancelNote: "ติดตั้งผิดรุ่น" });
});

test("cancelWarranty is still blocked while a non-cancelled claim exists (pre-check and under the lock)", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");
  const blockedMessage = "ไม่สามารถยกเลิกได้ — ยังมีใบเคลมที่ active อ้างอิงอยู่: WCM26090001";

  warranty = { ...warranty, claims: [{ id: "c-1", claimNo: "WCM26090001" }] };
  assert.deepEqual(await cancelWarranty(form()), { error: blockedMessage });
  assert.deepEqual(calls, []);

  warranty = { ...warranty, claims: [] };
  openClaimsInTx = [{ claimNo: "WCM26090001" }];
  assert.deepEqual(await cancelWarranty(form()), { error: blockedMessage });
  assert.deepEqual(calls, ["lock:Warranty:w-1"], "no write when a claim appeared meanwhile");
  assert.equal(audits.length, 0);
});

test("sale-created and already-cancelled warranties are refused", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");

  warranty = { ...warranty, createdVia: "AUTO_FROM_SALE", saleId: "sale-1" };
  assert.match((await cancelWarranty(form())).error ?? "", /ถูกสร้างอัตโนมัติจากใบขาย/);

  warranty = { ...warranty, createdVia: "MANUAL", saleId: null, status: "CANCELLED" };
  assert.deepEqual(await cancelWarranty(form()), { error: "รายการประกันนี้ถูกยกเลิกไปแล้ว" });
  assert.deepEqual(calls, []);
});
