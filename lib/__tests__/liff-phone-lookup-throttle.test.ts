import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

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
let throttleWrites: Array<{ kind: "reset" | "increment" | "lock"; key: string }> = [];
let matchedCustomers: MatchedCustomer[] = [];
let failNextUpsertWithUniqueConflict = false;

// Every fake statement first yields to the other in-flight requests, then reads
// and writes its row in one synchronous step — the way a single SQL statement
// is atomic. A read-modify-write done across two statements would lose updates.
const yieldToOtherRequests = (): Promise<void> => new Promise((resolveYield) => setImmediate(resolveYield));
const findRecord = (key: string): ThrottleRecord | undefined => throttleRecords.find((record) => record.key === key);

before(async () => {
  const loginThrottle = {
    findMany: async ({ where }: { where: { key: { in: string[] } } }) => {
      await yieldToOtherRequests();
      return throttleRecords.filter((record) => where.key.in.includes(record.key)).map((record) => ({ ...record }));
    },
    updateMany: async (args: {
      where: { key: string; OR: [{ firstFailureAt: null }, { firstFailureAt: { lt: Date } }] };
      data: { failures: number; firstFailureAt: Date; lockedUntil: null };
    }) => {
      await yieldToOtherRequests();
      const windowStart = args.where.OR[1].firstFailureAt.lt;
      const record = findRecord(args.where.key);
      if (!record || (record.firstFailureAt !== null && record.firstFailureAt >= windowStart)) return { count: 0 };
      Object.assign(record, args.data);
      throttleWrites.push({ kind: "reset", key: args.where.key });
      return { count: 1 };
    },
    upsert: async (args: {
      where: { key: string };
      create: ThrottleRecord;
      update: { failures: { increment: number } };
    }) => {
      await yieldToOtherRequests();
      if (failNextUpsertWithUniqueConflict) {
        // Another request inserted the first failure between this upsert's read and insert.
        failNextUpsertWithUniqueConflict = false;
        throttleRecords.push({ ...args.create });
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002", clientVersion: "test", meta: { target: ["key"] },
        });
      }
      throttleWrites.push({ kind: "increment", key: args.where.key });
      const record = findRecord(args.where.key);
      if (!record) {
        throttleRecords.push({ ...args.create });
        return { failures: args.create.failures };
      }
      record.failures += args.update.failures.increment;
      return { failures: record.failures };
    },
    update: async (args: { where: { key: string }; data: { lockedUntil: Date } }) => {
      await yieldToOtherRequests();
      const record = findRecord(args.where.key);
      assert.ok(record, "lock is only set on an existing row");
      Object.assign(record, args.data);
      throttleWrites.push({ kind: "lock", key: args.where.key });
      return { ...record };
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
  failNextUpsertWithUniqueConflict = false;
});

const counters = (): Array<{ key: string; failures: number; locked: boolean }> =>
  throttleRecords.map(({ key, failures, lockedUntil }) => ({ key, failures, locked: lockedUntil !== null }));

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
  assert.deepEqual(counters(), [
    { key: LINE_KEY, failures: 1, locked: false },
    { key: IP_KEY, failures: 1, locked: false },
  ]);
});

test("an AMBIGUOUS lookup counts one failure, and the IP key locks only at its 15th failure", async () => {
  matchedCustomers = [
    { id: "c1", code: "C0001", name: "ก", phone: "081-234-5678", lineUserId: null },
    { id: "c2", code: "C0002", name: "ข", phone: "0812345678", lineUserId: null },
  ];
  throttleRecords = [recentFailures(LINE_KEY, 1), recentFailures(IP_KEY, 14)];

  const result = await resolve();

  assert.equal(result.status, "AMBIGUOUS");
  assert.deepEqual(counters(), [
    { key: LINE_KEY, failures: 2, locked: false },
    { key: IP_KEY, failures: 15, locked: true },
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

test("parallel failed lookups never lose an increment and still lock at the limit", async () => {
  const { recordLiffPhoneLookupFailure } = await import("@/lib/liff-customer");
  throttleRecords = [recentFailures(LINE_KEY, 1), recentFailures(IP_KEY, 11)];

  await Promise.all([1, 2, 3, 4].map(() => recordLiffPhoneLookupFailure([LINE_KEY, IP_KEY])));

  assert.deepEqual(counters(), [
    { key: LINE_KEY, failures: 5, locked: true },
    { key: IP_KEY, failures: 15, locked: true },
  ]);
});

test("parallel failures after an expired window reset it once and count every failure", async () => {
  const { recordLiffPhoneLookupFailure } = await import("@/lib/liff-customer");
  const staleStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
  throttleRecords = [{ key: LINE_KEY, failures: 40, firstFailureAt: staleStart, lockedUntil: null }];

  await Promise.all([recordLiffPhoneLookupFailure([LINE_KEY]), recordLiffPhoneLookupFailure([LINE_KEY])]);

  assert.deepEqual(counters(), [{ key: LINE_KEY, failures: 2, locked: false }]);
  assert.ok(throttleRecords[0].firstFailureAt! > staleStart);
  assert.equal(throttleWrites.filter((write) => write.kind === "reset").length, 1);
});

test("two first failures racing on a new key both count", async () => {
  const { recordLiffPhoneLookupFailure } = await import("@/lib/liff-customer");

  await Promise.all([recordLiffPhoneLookupFailure([LINE_KEY]), recordLiffPhoneLookupFailure([LINE_KEY])]);
  assert.deepEqual(counters(), [{ key: LINE_KEY, failures: 2, locked: false }]);

  // The insert that loses a race (P2002) increments the winner's row instead of failing the lookup.
  throttleRecords = [];
  failNextUpsertWithUniqueConflict = true;
  await recordLiffPhoneLookupFailure([IP_KEY]);
  assert.deepEqual(counters(), [{ key: IP_KEY, failures: 2, locked: false }]);
});
