import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import type { Prisma, SaleLineDeliveryDispatch } from "@/lib/generated/prisma";
import { LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY } from "@/lib/line-delivery-settings";

const customer = { id: "customer1", name: "Customer", isActive: true, phone: "0812345678", lineUserId: "line1", lineLinkedAt: new Date("2026-01-01") };
const freshSale = () => ({ id: "sale1", saleNo: "SL202609290001", status: "ACTIVE", fulfillmentType: "DELIVERY", shippingMethod: "SELF", shippingStatus: "OUT_FOR_DELIVERY", customerId: "customer1", customer: { ...customer } });
let sale = freshSale();
let settings: Array<{ key: string; value: string }> = [];
const rows = new Map<string, SaleLineDeliveryDispatch>();
let httpCount = 0;
let failNextAcceptanceWrite = false;
let worker: typeof import("@/lib/line-delivery-worker");
let outbox: typeof import("@/lib/line-delivery-outbox");

const fakeDb = {
  sale: { findUnique: async () => sale },
  siteContent: { findMany: async () => settings },
  saleLineDeliveryDispatch: {
    findUnique: async ({ where }: { where: { id: string } }) => structuredClone(rows.get(where.id) ?? null),
    findMany: async () => [...rows.values()].map(row => ({ id: row.id })),
    createMany: async ({ data }: { data: Prisma.SaleLineDeliveryDispatchCreateManyInput[] }) => {
      const dataRow = data[0];
      if ([...rows.values()].some(row => row.saleId === dataRow.saleId && row.eventStatus === dataRow.eventStatus)) return { count: 0 };
      rows.set(dataRow.id!, {
        id: dataRow.id!, saleId: dataRow.saleId, eventStatus: dataRow.eventStatus,
        customerId: dataRow.customerId ?? null, recipientLineUserId: dataRow.recipientLineUserId ?? null,
        payload: dataRow.payload as Prisma.JsonValue, retryKey: dataRow.retryKey,
        state: dataRow.state ?? "PENDING", attemptCount: 0, lastErrorCode: dataRow.lastErrorCode ?? null,
        lineRequestId: null, eventAt: dataRow.eventAt as Date, firstAttemptAt: null,
        nextAttemptAt: dataRow.nextAttemptAt as Date | null, leaseUntil: null, acceptedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      return { count: 1 };
    },
    updateMany: async ({ where, data }: { where: Prisma.SaleLineDeliveryDispatchWhereInput; data: Prisma.SaleLineDeliveryDispatchUpdateManyMutationInput }) => {
      const row = rows.get(String(where.id));
      if (!row) return { count: 0 };
      if (where.OR) {
        if (where.attemptCount !== row.attemptCount) return { count: 0 };
        if (where.firstAttemptAt === null && row.firstAttemptAt !== null) return { count: 0 };
        if (where.firstAttemptAt instanceof Date && row.firstAttemptAt?.getTime() !== where.firstAttemptAt.getTime()) return { count: 0 };
        const now = Date.now();
        const due = (row.state === "PENDING" && row.nextAttemptAt && row.nextAttemptAt.getTime() <= now)
          || (row.state === "PROCESSING" && row.leaseUntil && row.leaseUntil.getTime() <= now);
        if (!due) return { count: 0 };
      } else if (where.state !== row.state || !(where.leaseUntil instanceof Date) || row.leaseUntil?.getTime() !== where.leaseUntil.getTime()) return { count: 0 };
      if (data.state === "ACCEPTED" && failNextAcceptanceWrite) {
        failNextAcceptanceWrite = false;
        throw new Error("DB outcome persistence failed after LINE acceptance");
      }
      for (const [key, value] of Object.entries(data)) {
        if (key === "attemptCount") row.attemptCount += 1;
        else Object.assign(row, { [key]: value });
      }
      return { count: 1 };
    },
  },
};
const tx = fakeDb as unknown as Prisma.TransactionClient;

before(async () => {
  const realDb = await import("@/lib/db");
  mock.module("@/lib/db", { namedExports: { ...realDb, db: fakeDb } });
  worker = await import("@/lib/line-delivery-worker");
  outbox = await import("@/lib/line-delivery-outbox");
});

beforeEach(() => {
  rows.clear(); sale = freshSale(); httpCount = 0; failNextAcceptanceWrite = false;
  settings = [{ key: LINE_DELIVERY_NOTIFICATIONS_KEY, value: "true" }, { key: "shop_name", value: "Test shop" }];
  process.env.APP_BASE_URL = "https://shop.test";
  process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN = "test-token";
});

const enqueue = async (previousStatus = "PENDING"): Promise<string | null> => outbox.enqueueSaleDeliveryLineNotification(tx, "sale1", previousStatus, new Date());
const fakeFetch = () => mock.method(globalThis, "fetch", async () => {
  httpCount += 1;
  return new Response(null, { status: 200, headers: { "x-line-request-id": "req1" } });
});

test("concurrent enqueues produce one immutable event per bill/status; rollback never enqueues", async () => {
  const ids = await Promise.all([enqueue(), enqueue()]);
  assert.equal(ids.filter(Boolean).length, 1);
  assert.equal(rows.size, 1);
  const original = structuredClone([...rows.values()][0]);
  assert.equal(await enqueue("OUT_FOR_DELIVERY"), null);
  assert.equal(await enqueue("DELIVERED"), null);
  sale.customer.name = "changed";
  assert.equal(await enqueue(), null);
  assert.deepEqual([...rows.values()][0], original);
  sale.shippingStatus = "DELIVERED";
  assert.ok(await enqueue("OUT_FOR_DELIVERY"));
  assert.equal(rows.size, 2);
});

test("direct delivery completion queues only its completion card", async () => {
  sale.shippingStatus = "DELIVERED";
  const id = await enqueue();
  assert.ok(id);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(id)!.eventStatus, "DELIVERED");
});

test("disabled or unlinked events stay sealed after enabling/linking and re-transitioning", async () => {
  for (const disabled of [true, false]) {
    rows.clear();
    settings[0].value = disabled ? "false" : "true";
    sale.customerId = disabled ? "customer1" : "";
    assert.equal(await enqueue(), null);
    const row = [...rows.values()][0];
    assert.equal(row.state, "SKIPPED");
    settings[0].value = "true"; sale.customerId = "customer1";
    assert.equal(await enqueue(), null);
    assert.equal(row.state, "SKIPPED");
  }
});

test("atomic worker claims prevent concurrent LINE pushes", async () => {
  const id = (await enqueue())!;
  const fetchMock = fakeFetch();
  try {
    await Promise.all([worker.processSaleDeliveryLineDispatch(id), worker.processSaleDeliveryLineDispatch(id)]);
    assert.equal(httpCount, 1);
    assert.equal(rows.get(id)!.state, "ACCEPTED");
    assert.equal(rows.get(id)!.attemptCount, 1);
  } finally { fetchMock.mock.restore(); }
});

test("cancel, changed recipient, stale status or shutdown before processing do not push", async () => {
  const fetchMock = fakeFetch();
  try {
    for (const reason of ["cancel", "recipient", "status", "disable", "disableThenEnable"]) {
      rows.clear(); sale = freshSale(); settings = [{ key: LINE_DELIVERY_NOTIFICATIONS_KEY, value: "true" }];
      const id = (await enqueue())!;
      if (reason === "cancel") sale.status = "CANCELLED";
      if (reason === "recipient") sale.customer.lineUserId = "other-line";
      if (reason === "status") sale.shippingStatus = "DELIVERED";
      if (reason === "disable") settings[0].value = "false";
      if (reason === "disableThenEnable") settings.push({ key: LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY, value: new Date(Date.now() + 1).toISOString() });
      await worker.processSaleDeliveryLineDispatch(id);
      assert.equal(rows.get(id)!.state, "SKIPPED", reason);
    }
    assert.equal(httpCount, 0);
  } finally { fetchMock.mock.restore(); }
});

test("network failure and failed acceptance persistence retain frozen key/body for recovery", async () => {
  const id = (await enqueue())!;
  const bodies: string[] = []; const keys: string[] = [];
  let attempt = 0;
  const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    bodies.push(String(init.body)); keys.push(new Headers(init.headers).get("X-Line-Retry-Key")!);
    attempt += 1;
    if (attempt === 1) throw new Error("network");
    return new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "req1" } });
  });
  try {
    await worker.processSaleDeliveryLineDispatch(id);
    const row = rows.get(id)!;
    assert.equal(row.state, "PENDING"); assert.ok(row.firstAttemptAt); assert.ok(row.nextAttemptAt);
    row.nextAttemptAt = new Date(0);
    failNextAcceptanceWrite = true;
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "PENDING");
    row.nextAttemptAt = new Date(0);
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "ACCEPTED");
    assert.equal(new Set(keys).size, 1); assert.equal(new Set(bodies).size, 1);
  } finally { fetchMock.mock.restore(); }
});

test("expired process leases recover while attempts outside the retry window fail without pushing", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  row.state = "PROCESSING"; row.leaseUntil = new Date(0); row.firstAttemptAt = new Date();
  const fetchMock = fakeFetch();
  try {
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "ACCEPTED"); assert.equal(httpCount, 1);
    row.state = "PENDING"; row.nextAttemptAt = new Date(0);
    row.firstAttemptAt = new Date(Date.now() - 24 * 60 * 60_000);
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "FAILED"); assert.equal(row.lastErrorCode, "RETRY_WINDOW_EXPIRED");
    assert.equal(httpCount, 1);
  } finally { fetchMock.mock.restore(); }
});

test("stale claim snapshot cannot reset first attempt time or extend retry identity", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  const stale = structuredClone(row);
  row.firstAttemptAt = new Date(Date.now() - 60_000);
  row.attemptCount = 1;
  const findMock = mock.method(fakeDb.saleLineDeliveryDispatch, "findUnique", async () => stale);
  const fetchMock = fakeFetch();
  try {
    const originalTime = row.firstAttemptAt.getTime();
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.firstAttemptAt.getTime(), originalTime);
    assert.equal(row.attemptCount, 1);
    assert.equal(httpCount, 0);
  } finally { findMock.mock.restore(); fetchMock.mock.restore(); }
});

test("retry deadline uses fresh time immediately before HTTP after database work", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  row.firstAttemptAt = new Date(Date.now() - 60_000);
  const future = Date.now() + 24 * 60 * 60_000;
  const clockMock = mock.method(Date, "now", () => future);
  const fetchMock = fakeFetch();
  try {
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "FAILED");
    assert.equal(row.lastErrorCode, "RETRY_WINDOW_EXPIRED");
    assert.equal(httpCount, 0);
  } finally { clockMock.mock.restore(); fetchMock.mock.restore(); }
});
