import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// On-site warranty (MANUAL, no sale) cancel: the row is kept with status CANCELLED
// instead of being deleted (a delete failed on the claim → warranty foreign key).
// A MANUAL warranty added to a sale line behaves like a sale warranty: blocked by any
// claim, otherwise DELETED so the line can get a warranty again.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type Row = Record<string, unknown>;

let warranty: Row | null = null;
let openClaimsInTx: Array<{ claimNo: string }> = [];
let claimWheresInTx: Row[] = [];
let existingForSaleLine: Row | null = null;
const calls: string[] = [];
const updates: Row[] = [];
const creates: Row[] = [];
const audits: Row[] = [];

const fakeDb = {
  $queryRaw: async (query: { strings?: string[]; values?: unknown[] }) => {
    calls.push(`lock:${(query.strings ?? []).join("?").match(/FROM "(\w+)"/)?.[1]}:${String(query.values?.[0])}`);
    return [];
  },
  warranty: {
    findUnique: async () => warranty,
    findFirst: async () => existingForSaleLine,
    create: async ({ data }: { data: Row }) => {
      calls.push("warranty.create");
      creates.push(data);
      return { id: "w-new", ...data };
    },
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
    findMany: async ({ where }: { where: Row }) => {
      claimWheresInTx.push(where);
      return openClaimsInTx;
    },
  },
  saleItem: {
    findUnique: async () => ({
      productId: "prod-1",
      quantity: 1,
      sale: { id: "sale-1", saleDate: new Date("2026-09-01T00:00:00Z"), customerId: "cust-1", customerName: "ลูกค้า" },
      product: { isLotControl: false },
      lotItems: [],
    }),
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
  claimWheresInTx = [];
  existingForSaleLine = null;
  calls.length = 0;
  updates.length = 0;
  creates.length = 0;
  audits.length = 0;
});

const saleLinked = (overrides: Row = {}): Row => ({
  ...warranty,
  saleId: "sale-1",
  saleItemId: "item-1",
  ...overrides,
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

  warranty = { ...warranty, claims: [{ claimNo: "WCM26090001", status: "SENT_TO_SUPPLIER" }] };
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

test("on-site cancel: a CANCELLED (kept) claim does not block, and only live claims are re-checked", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");
  warranty = { ...warranty, claims: [{ claimNo: "WCM26090001", status: "CANCELLED" }] };

  assert.deepEqual(await cancelWarranty(form()), { success: true });
  assert.deepEqual(calls, ["lock:Warranty:w-1", "warranty.update"]);
  assert.deepEqual(claimWheresInTx, [{ warrantyId: "w-1", status: { not: "CANCELLED" } }]);
});

test("manual WITH_SALE warranty cancel DELETES the row under Sale → Warranty locks and keeps the audit entry", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");
  warranty = saleLinked();

  const result = await cancelWarranty(form("  ใส่ผิดรายการ  "));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, ["lock:Sale:sale-1", "lock:Warranty:w-1", "warranty.delete"]);
  assert.equal(updates.length, 0, "never cancelled in place");
  assert.deepEqual(claimWheresInTx, [{ warrantyId: "w-1" }], "any claim, whatever its status, blocks");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "CANCEL");
  assert.equal(audits[0].entityType, "Warranty");
  assert.equal(audits[0].entityId, "w-1");
  assert.equal(audits[0].entityRef, "sale-1:item-1");
  assert.equal((audits[0].before as Row).saleItemId, "item-1");
  assert.deepEqual(audits[0].after, { deleted: true, cancelNote: "ใส่ผิดรายการ" });
  assert.deepEqual(audits[0].meta, { cancelNote: "ใส่ผิดรายการ", deleted: true });
});

test("manual WITH_SALE warranty cancel is blocked by any claim, with the claim numbers (pre-check and under the lock)", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");

  warranty = saleLinked({ claims: [{ claimNo: "WC26090001", status: "CANCELLED" }, { claimNo: "WC26090002", status: "DRAFT" }] });
  assert.deepEqual(await cancelWarranty(form()), {
    error: "ไม่สามารถยกเลิกได้ — ยังมีใบเคลมที่ active อ้างอิงอยู่: WC26090001, WC26090002",
  });
  assert.deepEqual(calls, []);

  warranty = saleLinked({ claims: [] });
  openClaimsInTx = [{ claimNo: "WC26090003" }];
  assert.deepEqual(await cancelWarranty(form()), {
    error: "ไม่สามารถยกเลิกได้ — ยังมีใบเคลมที่ active อ้างอิงอยู่: WC26090003",
  });
  assert.deepEqual(calls, ["lock:Sale:sale-1", "lock:Warranty:w-1"], "no delete when a claim appeared meanwhile");
  assert.equal(audits.length, 0);
});

test("manual WITH_SALE warranty removed by a sale edit meanwhile: reported as not found, nothing written", { skip: moduleMocksUnavailable }, async () => {
  const { cancelWarranty } = await import("../actions");
  const sequence: Array<Row | null> = [saleLinked(), null];
  const original = fakeDb.warranty.findUnique;
  fakeDb.warranty.findUnique = async () => sequence.shift() ?? null;
  try {
    assert.deepEqual(await cancelWarranty(form()), { error: "ไม่พบรายการประกัน" });
    assert.deepEqual(calls, ["lock:Sale:sale-1", "lock:Warranty:w-1"]);
    assert.equal(audits.length, 0);
  } finally {
    fakeDb.warranty.findUnique = original;
  }
});

test("after a WITH_SALE warranty is cancelled (deleted) the sale line can get a warranty again", { skip: moduleMocksUnavailable }, async () => {
  const { createWarranty } = await import("../actions");
  const withSaleForm = (): FormData => {
    const formData = new FormData();
    formData.set("mode", "WITH_SALE");
    formData.set("saleId", "sale-1");
    formData.set("saleItemId", "item-1");
    formData.set("warrantyDays", "90");
    return formData;
  };

  existingForSaleLine = { id: "w-live" };
  assert.deepEqual(await createWarranty(withSaleForm()), { error: "รายการสินค้านี้มีการบันทึกประกันไปแล้ว" });

  existingForSaleLine = null;
  assert.deepEqual(await createWarranty(withSaleForm()), { success: true });
  assert.equal(creates[0].createdVia, "MANUAL");
  assert.equal(creates[0].saleId, "sale-1");
  assert.equal(creates[0].saleItemId, "item-1");
});
