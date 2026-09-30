import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@/lib/generated/prisma";
import {
  assertPeriodsUnlocked, buildPeriodLockMessage, findLockedPeriods, PeriodLockedError,
} from "@/lib/period-lock";
import { parseDateOnlyToDate } from "@/lib/th-date";

type FakeCalls = { locks: string[]; queriedKeys: string[][] };

const fakeTx = (declared: Record<string, string>, calls: FakeCalls): Prisma.TransactionClient => ({
  $executeRaw: async (query: Prisma.Sql) => {
    calls.locks.push(String(query.values[0]));
    return 0;
  },
  profitDistribution: {
    findMany: async (args: { where: { activePeriodKey: { in: string[] } } }) => {
      calls.queriedKeys.push(args.where.activePeriodKey.in);
      return args.where.activePeriodKey.in
        .filter((key) => declared[key])
        .map((key) => ({ activePeriodKey: key, distributionNo: declared[key] }));
    },
  },
} as unknown as Prisma.TransactionClient);

test("no dates or undeclared months are not locked and take no query", async () => {
  const calls: FakeCalls = { locks: [], queriedKeys: [] };
  assert.deepEqual(await findLockedPeriods(fakeTx({}, calls), [null, undefined]), []);
  assert.equal(calls.queriedKeys.length, 0);
  const result = await assertPeriodsUnlocked(fakeTx({}, calls), [parseDateOnlyToDate("2026-09-15")]);
  assert.deepEqual(result, { locked: [], overridden: false });
});

test("uses the Thailand month and takes one shared lock per distinct month", async () => {
  const calls: FakeCalls = { locks: [], queriedKeys: [] };
  // 2026-08-31 17:30 UTC is already 1 September in Thailand.
  const locked = await findLockedPeriods(fakeTx({ "2026-09": "PD2026090001" }, calls), [
    new Date("2026-08-31T17:30:00.000Z"), parseDateOnlyToDate("2026-09-02"), parseDateOnlyToDate("2026-08-10"),
  ]);
  assert.deepEqual(calls.queriedKeys, [["2026-08", "2026-09"]]);
  assert.deepEqual(calls.locks, ["period-lock:2026-08", "period-lock:2026-09"]);
  assert.equal(locked.length, 1);
  assert.equal(locked[0].periodKey, "2026-09");
});

test("a declared month is rejected with the shared Thai message", async () => {
  const calls: FakeCalls = { locks: [], queriedKeys: [] };
  await assert.rejects(
    assertPeriodsUnlocked(fakeTx({ "2026-08": "PD2026080001" }, calls), [parseDateOnlyToDate("2026-08-20")]),
    (error: unknown) => {
      assert.ok(error instanceof PeriodLockedError);
      assert.ok(error.message.includes("PD2026080001"));
      assert.ok(error.message.includes("ลงวันที่ปัจจุบัน"));
      assert.ok(!error.message.includes("ปลดล็อก"));
      return true;
    },
  );
});

test("an allowed override needs a real reason", async () => {
  const calls: FakeCalls = { locks: [], queriedKeys: [] };
  const tx = fakeTx({ "2026-08": "PD2026080001" }, calls);
  const date = [parseDateOnlyToDate("2026-08-20")];
  await assert.rejects(assertPeriodsUnlocked(tx, date, { allowed: true, reason: "  " }), PeriodLockedError);
  await assert.rejects(assertPeriodsUnlocked(tx, date, { allowed: false, reason: "ลูกค้าขอใบเสร็จใหม่" }), PeriodLockedError);
  const result = await assertPeriodsUnlocked(tx, date, { allowed: true, reason: "ลูกค้าขอใบเสร็จใหม่" });
  assert.equal(result.overridden, true);
  assert.equal(result.locked[0].distributionNo, "PD2026080001");
});

test("override wording appears only for users who can override", () => {
  const periods = [{ periodKey: "2026-08", distributionNo: "PD2026080001", label: "สิงหาคม 2026" }];
  assert.ok(buildPeriodLockMessage(periods, true).includes("ปลดล็อก"));
  assert.ok(!buildPeriodLockMessage(periods, false).includes("ปลดล็อก"));
});
