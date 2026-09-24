import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// LIFF phone lookup throttle: only FAILED lookups (BLOCKED / AMBIGUOUS) count,
// the per-IP key allows 15 failures/hour (CGNAT-friendly) and the per-LINE-user
// key keeps 5 failures/hour. A successful LINK / REGISTER never consumes an attempt.

type ThrottleRecord = {
  key: string;
  failures: number;
  firstFailureAt: Date | null;
  lockedUntil: Date | null;
};

type MatchedCustomer = {
  id: string;
  code: string;
  name: string;
  phone: string;
  lineUserId: string | null;
};

const LINE_KEY = "liff-phone-lookup:line:line-user-1";
const IP_KEY = "liff-phone-lookup:ip:203.0.113.9";

let throttleRecords: ThrottleRecord[] = [];
let throttleWrites: Array<{ kind: "upsert" | "update"; key: string; failures: number; locked: boolean }> = [];
let matchedCustomers: MatchedCustomer[] = [];

before(async () => {
  const loginThrottle = {
    findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
      throttleRecords.filter((record) => where.key.in.includes(record.key)),
    upsert: async (args: { where: { key: string }; create: { failures: number; lockedUntil: Date | null } }) => {
      throttleWrites.push({
        kind: "upsert",
        key: args.where.key,
        failures: args.create.failures,
        locked: args.create.lockedUntil !== null,
      });
      return args;
    },
    update: async (args: { where: { key: string }; data: { failures: number; lockedUntil: Date | null } }) => {
      throttleWrites.push({
        kind: "update",
        key: args.where.key,
        failures: args.data.failures,
        locked: args.data.lockedUntil !== null,
      });
      return args;
    },
  };

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        loginThrottle,
        $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
        auditLog: { findFirst: async () => null },
        customer: {
          findFirst: async () => null,
          findMany: async () => matchedCustomers,
          update: async ({ where }: { where: { id: string } }) => {
            const customer = matchedCustomers.find((row) => row.id === where.id);
            return { id: where.id, code: customer?.code ?? "C0001", name: customer?.name ?? "ลูกค้า" };
          },
          create: async () => ({ id: "new-customer", code: "C0099", name: "ลูกค้าใหม่" }),
        },
      },
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      getRequestContextFromHeaders: (headers: Headers) => ({
        ipAddress: headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: null,
      }),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/notifications", {
    namedExports: { notifyLineCustomerLinked: async () => undefined },
  });
  await mock.module("@/lib/entity-code", {
    namedExports: { generateCustomerCode: async () => "C0099" },
  });
});

beforeEach(() => {
  throttleRecords = [];
  throttleWrites = [];
  matchedCustomers = [];
});

const recentFailures = (key: string, failures: number): ThrottleRecord => ({
  key,
  failures,
  firstFailureAt: new Date(Date.now() - 5 * 60 * 1000),
  lockedUntil: null,
});

const resolve = async () => {
  const { resolveLiffCustomerFromPhone } = await import("@/lib/liff-customer");
  return resolveLiffCustomerFromPhone({
    lineUserId: "line-user-1",
    displayName: "LINE customer",
    phone: "0812345678",
    throttleKeys: [LINE_KEY, IP_KEY],
  });
};

test("limits: per-IP 15 failures/hour, per-LINE-user 5 failures/hour", async () => {
  const { PHONE_LOOKUP_IP_LIMIT, PHONE_LOOKUP_LINE_USER_LIMIT, getLiffPhoneLookupLimit, getLiffPhoneLookupThrottleKeys } =
    await import("@/lib/liff-customer");

  assert.equal(PHONE_LOOKUP_IP_LIMIT, 15);
  assert.equal(PHONE_LOOKUP_LINE_USER_LIMIT, 5);

  const keys = getLiffPhoneLookupThrottleKeys(
    "line-user-1",
    new Request("https://shop.test/api/liff/verify-link", { headers: { "x-forwarded-for": "203.0.113.9" } }),
  );
  assert.deepEqual(keys, [LINE_KEY, IP_KEY]);
  assert.equal(getLiffPhoneLookupLimit(IP_KEY), 15);
  assert.equal(getLiffPhoneLookupLimit(LINE_KEY), 5);
});

test("a successful LINK does not consume a lookup attempt on either key", async () => {
  matchedCustomers = [{ id: "c1", code: "C0001", name: "ลูกค้าเดิม", phone: "081-234-5678", lineUserId: null }];

  const result = await resolve();

  assert.equal(result.status, "LINKED");
  assert.deepEqual(throttleWrites, []);
});

test("a successful REGISTER (phone not on file) does not consume a lookup attempt", async () => {
  matchedCustomers = [];

  const result = await resolve();

  assert.equal(result.status, "REGISTERED");
  assert.deepEqual(throttleWrites, []);
});

test("a BLOCKED lookup counts one failure against both keys", async () => {
  matchedCustomers = [{ id: "c1", code: "C0001", name: "ลูกค้าเดิม", phone: "081-234-5678", lineUserId: "other-line-user" }];

  const result = await resolve();

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(
    throttleWrites.map(({ key, failures }) => ({ key, failures })),
    [
      { key: LINE_KEY, failures: 1 },
      { key: IP_KEY, failures: 1 },
    ],
  );
});

test("an AMBIGUOUS lookup counts one failure, and the IP key locks only at its 15th failure", async () => {
  matchedCustomers = [
    { id: "c1", code: "C0001", name: "ก", phone: "081-234-5678", lineUserId: null },
    { id: "c2", code: "C0002", name: "ข", phone: "0812345678", lineUserId: null },
  ];
  throttleRecords = [recentFailures(LINE_KEY, 1), recentFailures(IP_KEY, 14)];

  const result = await resolve();

  assert.equal(result.status, "AMBIGUOUS");
  assert.deepEqual(throttleWrites, [
    { kind: "update", key: LINE_KEY, failures: 2, locked: false },
    { kind: "update", key: IP_KEY, failures: 15, locked: true },
  ]);
});

test("a shared IP with 14 failures still lets a new customer through", async () => {
  throttleRecords = [recentFailures(IP_KEY, 14)];
  matchedCustomers = [{ id: "c1", code: "C0001", name: "ลูกค้าเดิม", phone: "081-234-5678", lineUserId: null }];

  const result = await resolve();

  assert.equal(result.status, "LINKED");
});

test("the IP key blocks at 15 failures and the LINE-user key blocks at 5", async () => {
  const { assertLiffPhoneLookupAllowed } = await import("@/lib/liff-customer");

  throttleRecords = [recentFailures(IP_KEY, 15)];
  await assert.rejects(assertLiffPhoneLookupAllowed([LINE_KEY, IP_KEY]), /ลองหลายครั้งเกินไป/);

  throttleRecords = [recentFailures(LINE_KEY, 5)];
  await assert.rejects(assertLiffPhoneLookupAllowed([LINE_KEY, IP_KEY]), /ลองหลายครั้งเกินไป/);

  throttleRecords = [recentFailures(LINE_KEY, 4), recentFailures(IP_KEY, 14)];
  await assertLiffPhoneLookupAllowed([LINE_KEY, IP_KEY]);

  // The check itself is read-only.
  assert.deepEqual(throttleWrites, []);
});

test("failures older than the 1-hour window no longer block", async () => {
  const { assertLiffPhoneLookupAllowed } = await import("@/lib/liff-customer");

  throttleRecords = [
    { key: IP_KEY, failures: 40, firstFailureAt: new Date(Date.now() - 2 * 60 * 60 * 1000), lockedUntil: null },
  ];
  await assertLiffPhoneLookupAllowed([LINE_KEY, IP_KEY]);
});
