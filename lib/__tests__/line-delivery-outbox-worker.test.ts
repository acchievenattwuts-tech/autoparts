import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import type { Prisma, SaleLineDeliveryDispatch } from "@/lib/generated/prisma";
import { LINE_DELIVERY_NOTIFICATIONS_KEY, LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY } from "@/lib/line-delivery-settings";
import { DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON } from "@/lib/line-delivery-policy";

const customer = { id: "customer1", name: "Customer", isActive: true, phone: "0812345678", lineUserId: "line1", lineLinkedAt: new Date("2026-01-01") };
const freshSale = () => ({ id: "sale1", saleNo: "SL202609290001", status: "ACTIVE", channel: "STORE", saleDate: new Date(), fulfillmentType: "DELIVERY", shippingMethod: "SELF", shippingStatus: "OUT_FOR_DELIVERY", customerId: "customer1", customer: { ...customer } });
let sale = freshSale();
let settings: Array<{ key: string; value: string }> = [];
const rows = new Map<string, SaleLineDeliveryDispatch>();
let httpCount = 0;
let failNextAcceptanceWrite = false;
let failureAlerts: string[] = [];
let afterCallbacks: Array<() => unknown> = [];
let worker: typeof import("@/lib/line-delivery-worker");
let outbox: typeof import("@/lib/line-delivery-outbox");

const fakeDb = {
  sale: { findUnique: async () => sale },
  siteContent: { findMany: async () => settings },
  saleLineDeliveryDispatch: {
    findUnique: async ({ where }: { where: { id?: string; saleId_eventStatus?: { saleId: string; eventStatus: string } } }) => {
      const key = where.saleId_eventStatus;
      const row = key
        ? [...rows.values()].find(candidate => candidate.saleId === key.saleId && candidate.eventStatus === key.eventStatus)
        : rows.get(String(where.id));
      return structuredClone(row ?? null);
    },
    findMany: async ({ where, take }: { where: Prisma.SaleLineDeliveryDispatchWhereInput; take?: number }) => {
      if (!isRetentionWhere(where)) {
        const due = (where.OR ?? []) as Prisma.SaleLineDeliveryDispatchWhereInput[];
        return [...rows.values()].filter(row => due.some(condition => matchesDispatchWhere(row, condition))).slice(0, take).map(row => ({ id: row.id }));
      }
      return [...rows.values()].filter(row => matchesRetention(row, where)).slice(0, take).map(row => ({ id: row.id }));
    },
    deleteMany: async ({ where }: { where: { AND: [{ id: { in: string[] } }, Prisma.SaleLineDeliveryDispatchWhereInput] } }) => {
      const [{ id }, retention] = where.AND;
      let count = 0;
      for (const rowId of id.in) {
        const row = rows.get(rowId);
        if (row && matchesRetention(row, retention)) { rows.delete(rowId); count += 1; }
      }
      return { count };
    },
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
      if (!row || !matchesDispatchWhere(row, where)) return { count: 0 };
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

// Evaluates the where shapes the worker uses: id/state/attemptCount equality,
// an exact lease Date, and `{ lte }` time bounds.
function matchesDispatchWhere(row: SaleLineDeliveryDispatch, where: Prisma.SaleLineDeliveryDispatchWhereInput): boolean {
  if (typeof where.id === "string" && where.id !== row.id) return false;
  if (typeof where.state === "string" && where.state !== row.state) return false;
  if (typeof where.attemptCount === "number" && where.attemptCount !== row.attemptCount) return false;
  return matchesTime(row.nextAttemptAt, where.nextAttemptAt) && matchesTime(row.leaseUntil, where.leaseUntil);
}
function matchesTime(value: Date | null, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition instanceof Date) return value?.getTime() === condition.getTime();
  const { lte } = condition as { lte: Date };
  return value !== null && value.getTime() <= lte.getTime();
}

type RetentionWhere = { state: { in: string[] }; updatedAt: { lt: Date } };
function isRetentionWhere(where: Prisma.SaleLineDeliveryDispatchWhereInput): boolean {
  return typeof where.state === "object" && where.state !== null && "in" in where.state;
}
function matchesRetention(row: SaleLineDeliveryDispatch, where: Prisma.SaleLineDeliveryDispatchWhereInput): boolean {
  const { state, updatedAt } = where as RetentionWhere;
  return state.in.includes(row.state) && row.updatedAt.getTime() < updatedAt.lt.getTime();
}

before(async () => {
  const realDb = await import("@/lib/db");
  mock.module("@/lib/db", { namedExports: { ...realDb, db: fakeDb } });
  mock.module("@/lib/notifications", {
    namedExports: { safeNotifyLineDeliveryFailed: async (dispatchId: string) => { failureAlerts.push(dispatchId); } },
  });
  const realNextServer = await import("next/server");
  mock.module("next/server", {
    namedExports: { ...realNextServer, after: (callback: () => unknown) => { afterCallbacks.push(callback); } },
  });
  worker = await import("@/lib/line-delivery-worker");
  outbox = await import("@/lib/line-delivery-outbox");
});

beforeEach(() => {
  rows.clear(); sale = freshSale(); httpCount = 0; failNextAcceptanceWrite = false;
  failureAlerts = []; afterCallbacks = [];
  delete process.env.NEXT_PUBLIC_LINE_LIFF_ID;
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

test("a never-attempted PENDING card is sent by the cron on its first attempt, with its retry key", async () => {
  const id = (await enqueue())!;
  const keys: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    httpCount += 1;
    keys.push(new Headers(init.headers).get("X-Line-Retry-Key") ?? "");
    return new Response(null, { status: 200, headers: { "x-line-request-id": "req1" } });
  });
  try {
    await worker.processPendingSaleDeliveryLineDispatches();
    const row = rows.get(id)!;
    assert.equal(row.state, "ACCEPTED");
    assert.equal(row.attemptCount, 1);
    assert.deepEqual(keys, [row.retryKey]);
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(httpCount, 1);
    assert.deepEqual(failureAlerts, []);
  } finally { fetchMock.mock.restore(); }
});

// Owner decision T6: one attempt; every failure is terminal FAILED with one alert.
type SendFailureCase = { name: string; code: string; http: number; arrange: () => void; respond?: () => Promise<Response> };
const SEND_FAILURE_CASES: SendFailureCase[] = [
  ...[400, 401, 403, 409, 429, 500, 503].map((status): SendFailureCase => ({
    name: `LINE HTTP ${status}`, code: `LINE_HTTP_${status}`, http: 1, arrange: () => {},
    respond: async () => new Response(null, { status }),
  })),
  { name: "network error", code: "LINE_NETWORK_ERROR", http: 1, arrange: () => {}, respond: async () => { throw new Error("socket hang up"); } },
  {
    name: "timeout", code: "LINE_NETWORK_ERROR", http: 1, arrange: () => {},
    respond: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
  },
  { name: "missing access token", code: "LINE_CONFIG_MISSING", http: 0, arrange: () => { delete process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN; } },
  { name: "malformed card payload", code: "INVALID_PAYLOAD", http: 0, arrange: () => { for (const row of rows.values()) row.payload = {}; } },
];

test("every send failure ends FAILED on the single attempt with one alert and is never re-sent", async () => {
  for (const failure of SEND_FAILURE_CASES) {
    rows.clear(); failureAlerts = []; httpCount = 0;
    process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN = "test-token";
    const id = (await enqueue())!;
    failure.arrange();
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      httpCount += 1;
      return failure.respond ? failure.respond() : new Response(null, { status: 200 });
    });
    try {
      await worker.processSaleDeliveryLineDispatch(id);
      const row = rows.get(id)!;
      assert.equal(row.state, "FAILED", failure.name);
      assert.equal(row.lastErrorCode, failure.code, failure.name);
      assert.equal(row.nextAttemptAt, null, failure.name);
      assert.equal(row.leaseUntil, null, failure.name);
      assert.deepEqual(failureAlerts, [id], failure.name);
      await worker.processPendingSaleDeliveryLineDispatches();
      await worker.processSaleDeliveryLineDispatch(id);
      assert.equal(row.state, "FAILED", failure.name);
      assert.equal(row.attemptCount, 1, failure.name);
      assert.equal(httpCount, failure.http, `${failure.name}: never re-sent`);
      assert.deepEqual(failureAlerts, [id], `${failure.name}: alerted once`);
    } finally { fetchMock.mock.restore(); }
  }
});

test("an expired lease becomes FAILED LEASE_EXPIRED with one alert and no second send; a live lease is left alone", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  row.state = "PROCESSING"; row.attemptCount = 1; row.firstAttemptAt = new Date();
  row.leaseUntil = new Date(Date.now() + 60_000);
  const fetchMock = fakeFetch();
  try {
    await worker.processPendingSaleDeliveryLineDispatches();
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "PROCESSING", "a worker still holds the lease");
    assert.deepEqual(failureAlerts, []);
    row.leaseUntil = new Date(0); // the worker crashed mid-send: the result is unknown
    await Promise.all([worker.processPendingSaleDeliveryLineDispatches(), worker.processPendingSaleDeliveryLineDispatches()]);
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "FAILED");
    assert.equal(row.lastErrorCode, "LEASE_EXPIRED");
    assert.equal(row.leaseUntil, null);
    assert.equal(row.attemptCount, 1);
    assert.equal(httpCount, 0);
    assert.deepEqual(failureAlerts, [id]);
  } finally { fetchMock.mock.restore(); }
});

test("a failed write after LINE accepted the card is closed as LEASE_EXPIRED, never re-sent", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  failNextAcceptanceWrite = true;
  const logged: unknown[][] = [];
  const errorMock = mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const fetchMock = fakeFetch();
  try {
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "PROCESSING");
    assert.deepEqual(failureAlerts, [], "not labelled a send failure");
    row.leaseUntil = new Date(0);
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "FAILED");
    assert.equal(row.lastErrorCode, "LEASE_EXPIRED");
    assert.equal(httpCount, 1);
    assert.deepEqual(failureAlerts, [id]);
  } finally { fetchMock.mock.restore(); errorMock.mock.restore(); }
  assert.deepEqual(logged, [["[line-delivery] dispatch deferred to recovery", { code: "Error", dispatchId: id }]]);
});

test("a stale PENDING snapshot of a row another worker already claimed sends nothing", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  const stale = structuredClone(row);
  const leaseUntil = new Date(Date.now() + 60_000);
  Object.assign(row, { state: "PROCESSING", attemptCount: 1, firstAttemptAt: new Date(), leaseUntil });
  const findMock = mock.method(fakeDb.saleLineDeliveryDispatch, "findUnique", async () => stale);
  const fetchMock = fakeFetch();
  try {
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "PROCESSING");
    assert.equal(row.attemptCount, 1);
    assert.equal(row.leaseUntil, leaseUntil);
    assert.equal(httpCount, 0);
  } finally { findMock.mock.restore(); fetchMock.mock.restore(); }
});

test("a retry scheduled before the single-attempt policy is closed FAILED with its code, never re-sent", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  Object.assign(row, { attemptCount: 1, firstAttemptAt: new Date(Date.now() - 60_000), lastErrorCode: "LINE_HTTP_503", nextAttemptAt: new Date(Date.now() + 60_000) });
  const fetchMock = fakeFetch();
  try {
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "PENDING", "closed only when its scheduled time comes due");
    row.nextAttemptAt = new Date(0);
    await worker.processPendingSaleDeliveryLineDispatches();
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(row.state, "FAILED");
    assert.equal(row.lastErrorCode, "LINE_HTTP_503");
    assert.equal(row.nextAttemptAt, null);
    assert.equal(httpCount, 0);
    assert.deepEqual(failureAlerts, [id]);
  } finally { fetchMock.mock.restore(); }
});

// Shipping status helpers for the undo sequences below. `previous` is the status
// the admin action moves away from, exactly as updateShippingStatus passes it.
const moveTo = async (next: "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED"): Promise<string | null> => {
  const previous = sale.shippingStatus;
  sale.shippingStatus = next;
  return enqueue(previous);
};
const rowFor = (eventStatus: string): SaleLineDeliveryDispatch | undefined =>
  [...rows.values()].find(row => row.eventStatus === eventStatus);

test("PENDING -> DELIVERED (card sent) -> OUT -> PENDING -> OUT never sends out-for-delivery after delivered", async () => {
  sale.shippingStatus = "PENDING";
  const fetchMock = fakeFetch();
  try {
    const deliveredId = await moveTo("DELIVERED");
    assert.ok(deliveredId);
    await worker.processSaleDeliveryLineDispatch(deliveredId);
    assert.equal(rows.get(deliveredId)!.state, "ACCEPTED");
    assert.equal(await moveTo("OUT_FOR_DELIVERY"), null); // undo: never a new outgoing event
    assert.equal(await moveTo("PENDING"), null); // undo again
    assert.equal(await moveTo("OUT_FOR_DELIVERY"), null);
    const outRow = rowFor("OUT_FOR_DELIVERY")!;
    assert.equal(outRow.state, "SKIPPED");
    assert.equal(outRow.lastErrorCode, "ALREADY_DELIVERED");
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(httpCount, 1); // only the original "delivered" card
  } finally { fetchMock.mock.restore(); }
});

test("undo sequence before the delivered card is sent leaves the customer with no card at all", async () => {
  sale.shippingStatus = "PENDING";
  const fetchMock = fakeFetch();
  try {
    const deliveredId = await moveTo("DELIVERED"); // enqueued, still PENDING
    assert.ok(deliveredId);
    await moveTo("OUT_FOR_DELIVERY");
    await moveTo("PENDING");
    assert.equal(await moveTo("OUT_FOR_DELIVERY"), null);
    assert.equal(rowFor("OUT_FOR_DELIVERY")!.lastErrorCode, "ALREADY_DELIVERED");
    await worker.processSaleDeliveryLineDispatch(deliveredId);
    assert.equal(rows.get(deliveredId)!.state, "SKIPPED");
    assert.equal(rows.get(deliveredId)!.lastErrorCode, "STALE_STATUS");
    assert.equal(httpCount, 0);
  } finally { fetchMock.mock.restore(); }
});

test("a delivered card that was never sent does not hold back a later out-for-delivery card", async () => {
  sale.shippingStatus = "PENDING";
  settings[0].value = "false";
  assert.equal(await moveTo("DELIVERED"), null);
  assert.equal(rowFor("DELIVERED")!.lastErrorCode, "SETTING_DISABLED");
  settings[0].value = "true";
  await moveTo("OUT_FOR_DELIVERY");
  await moveTo("PENDING");
  const outId = await moveTo("OUT_FOR_DELIVERY");
  assert.ok(outId);
  assert.equal(rows.get(outId)!.state, "PENDING");
});

test("worker pre-send check skips a not-yet-attempted out-for-delivery card once delivered was sent", async () => {
  const fetchMock = fakeFetch();
  try {
    sale.shippingStatus = "PENDING";
    const outId = (await moveTo("OUT_FOR_DELIVERY"))!; // queued; its first attempt has not run yet
    const deliveredId = (await moveTo("DELIVERED"))!;
    await worker.processSaleDeliveryLineDispatch(deliveredId);
    assert.equal(rows.get(deliveredId)!.state, "ACCEPTED");
    await moveTo("OUT_FOR_DELIVERY"); // undo DELIVERED: the old OUT row matches the status again
    await worker.processPendingSaleDeliveryLineDispatches();
    assert.equal(rows.get(outId)!.state, "SKIPPED");
    assert.equal(rows.get(outId)!.lastErrorCode, "ALREADY_DELIVERED");
    assert.equal(httpCount, 1); // the delivered card only
  } finally { fetchMock.mock.restore(); }
});

// Owner decision P7a: a delivered card that ended FAILED with an unknown result (the request may have
// reached LINE) holds back a later out-for-delivery card; a definite rejection does not. Each failure is
// produced by the real worker/transport path so the classified codes stay in sync with what they write.
let deliveredCardResponse: (() => Promise<Response>) | null = null;
const cardFetch = () => mock.method(globalThis, "fetch", async () => {
  httpCount += 1;
  const respond = deliveredCardResponse;
  deliveredCardResponse = null;
  return respond ? respond() : new Response(null, { status: 200, headers: { "x-line-request-id": "req1" } });
});
type DeliveredFailureCase = { name: string; code: string; unknownResult: boolean; fail: (id: string) => Promise<void> };
const failOnLine = (respond: () => Promise<Response>) => async (id: string): Promise<void> => {
  deliveredCardResponse = respond;
  await worker.processSaleDeliveryLineDispatch(id);
};
const DELIVERED_FAILURE_CASES: DeliveredFailureCase[] = [
  { name: "network error", code: "LINE_NETWORK_ERROR", unknownResult: true, fail: failOnLine(async () => { throw new Error("socket hang up"); }) },
  {
    name: "timeout", code: "LINE_NETWORK_ERROR", unknownResult: true,
    fail: failOnLine(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }),
  },
  ...[500, 503].map((status): DeliveredFailureCase => ({
    name: `LINE HTTP ${status}`, code: `LINE_HTTP_${status}`, unknownResult: true, fail: failOnLine(async () => new Response(null, { status })),
  })),
  {
    name: "worker died mid-send", code: "LEASE_EXPIRED", unknownResult: true,
    fail: async (id) => {
      Object.assign(rows.get(id)!, { state: "PROCESSING", attemptCount: 1, firstAttemptAt: new Date(), leaseUntil: new Date(0) });
      await worker.processSaleDeliveryLineDispatch(id);
    },
  },
  ...[400, 401, 403, 429].map((status): DeliveredFailureCase => ({
    name: `LINE HTTP ${status}`, code: `LINE_HTTP_${status}`, unknownResult: false, fail: failOnLine(async () => new Response(null, { status })),
  })),
  {
    name: "missing access token", code: "LINE_CONFIG_MISSING", unknownResult: false,
    fail: async (id) => {
      delete process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN;
      try { await worker.processSaleDeliveryLineDispatch(id); } finally { process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN = "test-token"; }
    },
  },
  {
    name: "malformed card payload", code: "INVALID_PAYLOAD", unknownResult: false,
    fail: async (id) => { rows.get(id)!.payload = {}; await worker.processSaleDeliveryLineDispatch(id); },
  },
];
const resetForCase = (): void => {
  rows.clear(); sale = freshSale(); sale.shippingStatus = "PENDING";
  httpCount = 0; failureAlerts = []; deliveredCardResponse = null;
};

test("enqueue: a delivered card that failed with an unknown result seals the later out-for-delivery card", async () => {
  const fetchMock = cardFetch();
  try {
    for (const failure of DELIVERED_FAILURE_CASES) {
      resetForCase();
      const deliveredId = (await moveTo("DELIVERED"))!;
      await failure.fail(deliveredId);
      assert.deepEqual([rows.get(deliveredId)!.state, rows.get(deliveredId)!.lastErrorCode], ["FAILED", failure.code], failure.name);
      const deliveredHttp = httpCount;
      assert.equal(await moveTo("OUT_FOR_DELIVERY"), null, failure.name); // undo: never a new outgoing event
      await moveTo("PENDING");
      const outId = await moveTo("OUT_FOR_DELIVERY");
      const outRow = rowFor("OUT_FOR_DELIVERY")!;
      if (failure.unknownResult) {
        assert.equal(outId, null, failure.name);
        assert.deepEqual([outRow.state, outRow.lastErrorCode], ["SKIPPED", DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON], failure.name);
      } else {
        assert.equal(outId, outRow.id, failure.name);
        assert.equal(outRow.state, "PENDING", failure.name);
      }
      await worker.processPendingSaleDeliveryLineDispatches();
      assert.equal(outRow.state, failure.unknownResult ? "SKIPPED" : "ACCEPTED", failure.name);
      assert.equal(httpCount, deliveredHttp + (failure.unknownResult ? 0 : 1), `${failure.name}: out-for-delivery sends`);
      assert.deepEqual(failureAlerts, [deliveredId], `${failure.name}: only the delivered failure alerts`);
    }
  } finally { fetchMock.mock.restore(); }
});

test("worker pre-send check: a queued out-for-delivery card is skipped once the delivered card failed with an unknown result", async () => {
  const fetchMock = cardFetch();
  try {
    for (const failure of DELIVERED_FAILURE_CASES) {
      resetForCase();
      const outId = (await moveTo("OUT_FOR_DELIVERY"))!; // queued; its first attempt has not run yet
      const deliveredId = (await moveTo("DELIVERED"))!;
      await failure.fail(deliveredId);
      assert.equal(rows.get(deliveredId)!.lastErrorCode, failure.code, failure.name);
      const deliveredHttp = httpCount;
      await moveTo("OUT_FOR_DELIVERY"); // undo DELIVERED: the old OUT row matches the status again
      await worker.processPendingSaleDeliveryLineDispatches();
      const outRow = rows.get(outId)!;
      if (failure.unknownResult) {
        assert.deepEqual([outRow.state, outRow.lastErrorCode], ["SKIPPED", DELIVERED_OUTCOME_UNKNOWN_SKIP_REASON], failure.name);
      } else {
        assert.deepEqual([outRow.state, outRow.lastErrorCode], ["ACCEPTED", null], failure.name);
      }
      assert.equal(httpCount, deliveredHttp + (failure.unknownResult ? 0 : 1), `${failure.name}: out-for-delivery sends`);
      assert.deepEqual(failureAlerts, [deliveredId], `${failure.name}: a skip never alerts`);
    }
  } finally { fetchMock.mock.restore(); }
});

test("marketplace sales are sealed as skipped at enqueue and skipped again before sending", async () => {
  const fetchMock = fakeFetch();
  try {
    sale.channel = "SHOPEE";
    assert.equal(await enqueue(), null);
    assert.equal(rowFor("OUT_FOR_DELIVERY")!.state, "SKIPPED");
    assert.equal(rowFor("OUT_FOR_DELIVERY")!.lastErrorCode, "MARKETPLACE_CHANNEL");
    rows.clear(); sale = freshSale();
    const id = (await enqueue())!;
    sale.channel = "LAZADA";
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(rows.get(id)!.lastErrorCode, "MARKETPLACE_CHANNEL");
    assert.equal(httpCount, 0);
  } finally { fetchMock.mock.restore(); }
});

test("retention deletes only finished dispatch rows older than 60 days, in bounded batches", async () => {
  const now = new Date("2026-09-30T00:00:00.000Z");
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60_000);
  const addRow = (id: string, state: string, updatedAt: Date): void => {
    rows.set(id, {
      id, saleId: `sale-${id}`, eventStatus: "DELIVERED", customerId: "customer1", recipientLineUserId: "line1",
      payload: {}, retryKey: id, state, attemptCount: 0, lastErrorCode: null, lineRequestId: null,
      eventAt: updatedAt, firstAttemptAt: null, nextAttemptAt: null, leaseUntil: null, acceptedAt: null,
      createdAt: updatedAt, updatedAt,
    });
  };
  for (let index = 0; index < 1_100; index += 1) addRow(`old-accepted-${index}`, "ACCEPTED", daysAgo(61));
  addRow("old-skipped", "SKIPPED", daysAgo(90));
  addRow("old-failed", "FAILED", daysAgo(61));
  addRow("old-pending", "PENDING", daysAgo(200));
  addRow("old-processing", "PROCESSING", daysAgo(200));
  addRow("recent-accepted", "ACCEPTED", daysAgo(59));
  assert.equal(worker.LINE_DELIVERY_DISPATCH_RETENTION_DAYS, 60);
  assert.equal(await worker.deleteExpiredSaleDeliveryDispatches(now), 1_102);
  assert.deepEqual([...rows.keys()].sort(), ["old-pending", "old-processing", "recent-accepted"]);
  assert.equal(await worker.deleteExpiredSaleDeliveryDispatches(now), 0);
});

test("missing LINE configuration alerts as a terminal failure", async () => {
  delete process.env.LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN;
  const id = (await enqueue())!;
  await worker.processSaleDeliveryLineDispatch(id);
  assert.equal(rows.get(id)!.lastErrorCode, "LINE_CONFIG_MISSING");
  assert.deepEqual(failureAlerts, [id]);
});

test("a late failure after the cron closed the expired lease writes nothing and sends no second alert", async () => {
  const id = (await enqueue())!;
  const row = rows.get(id)!;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    httpCount += 1;
    row.leaseUntil = new Date(0); // the attempt outlived its lease
    await worker.processPendingSaleDeliveryLineDispatches(); // cron closes it as LEASE_EXPIRED
    return new Response(null, { status: 400 });
  });
  try {
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(row.state, "FAILED");
    assert.equal(row.lastErrorCode, "LEASE_EXPIRED");
    assert.equal(httpCount, 1);
    assert.deepEqual(failureAlerts, [id]);
  } finally { fetchMock.mock.restore(); }
});

test("an invalid app URL seals the event FAILED and alerts only after the response", async () => {
  process.env.APP_BASE_URL = "http://shop.test";
  assert.equal(await enqueue(), null);
  const row = [...rows.values()][0];
  assert.equal(row.state, "FAILED");
  assert.equal(row.lastErrorCode, "INVALID_APP_URL");
  assert.deepEqual(failureAlerts, [], "never alerts inside the status transaction");
  assert.equal(afterCallbacks.length, 1);
  await afterCallbacks[0]();
  assert.deepEqual(failureAlerts, [row.id]);
  // A duplicate enqueue of the same event creates no row and schedules nothing.
  assert.equal(await enqueue(), null);
  assert.equal(afterCallbacks.length, 1);
});

test("bills sold more than 30 days before the event are skipped at enqueue and before sending", async () => {
  const fetchMock = fakeFetch();
  try {
    sale.saleDate = new Date(Date.now() - 32 * 24 * 60 * 60_000);
    assert.equal(await enqueue(), null);
    assert.equal(rowFor("OUT_FOR_DELIVERY")!.state, "SKIPPED");
    assert.equal(rowFor("OUT_FOR_DELIVERY")!.lastErrorCode, "SALE_TOO_OLD");
    rows.clear(); sale = freshSale();
    const id = (await enqueue())!;
    sale.saleDate = new Date(Date.now() - 32 * 24 * 60 * 60_000); // bill date edited backwards before sending
    await worker.processSaleDeliveryLineDispatch(id);
    assert.equal(rows.get(id)!.state, "SKIPPED");
    assert.equal(rows.get(id)!.lastErrorCode, "SALE_TOO_OLD");
    assert.equal(httpCount, 0);
    assert.deepEqual(failureAlerts, []);
  } finally { fetchMock.mock.restore(); }
});

test("the card button uses the LIFF launch URL when a LIFF ID is configured", async () => {
  process.env.NEXT_PUBLIC_LINE_LIFF_ID = "1234567890-AbCdEfGh";
  const id = (await enqueue())!;
  const rendered = JSON.stringify(rows.get(id)!.payload);
  assert.ok(rendered.includes("https://liff.line.me/1234567890-AbCdEfGh/orders/sale1"));
  assert.ok(!rendered.includes("https://shop.test/liff/orders"));
});

test("worker failure logs carry only the error code and dispatch id", async () => {
  const logged: unknown[][] = [];
  const errorMock = mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const leakyError = Object.assign(new Error("customer U0123456789abcdef0123456789abcdef"), { code: "P1001" });
  const findMock = mock.method(fakeDb.saleLineDeliveryDispatch, "findUnique", async () => { throw leakyError; });
  try {
    await worker.processSaleDeliveryLineDispatch("dispatch-x");
  } finally { findMock.mock.restore(); }
  const id = (await enqueue())!;
  const updateMock = mock.method(fakeDb.saleLineDeliveryDispatch, "updateMany", async (args: { data: { state?: string } }) => {
    if (args.data.state === "FAILED") throw leakyError;
    return { count: 1 };
  });
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(null, { status: 400 }));
  try {
    await worker.processSaleDeliveryLineDispatch(id);
  } finally { updateMock.mock.restore(); fetchMock.mock.restore(); errorMock.mock.restore(); }
  assert.deepEqual(logged, [
    ["[line-delivery] dispatch deferred to recovery", { code: "P1001", dispatchId: "dispatch-x" }],
    ["[line-delivery] failed to persist attempt outcome", { code: "P1001", dispatchId: id }],
  ]);
  assert.deepEqual(failureAlerts, []);
});
