import assert from "node:assert/strict";
import test from "node:test";
import { addThailandDays, getThailandDateKey, parseDateOnlyToDate, startOfThailandDay } from "@/lib/th-date";
import {
  chunkLotKeys,
  classifyLotExpiry,
  compareLotsByExpiry,
  groupLotKeysByProduct,
  lotKeyOf,
  pageSlice,
} from "../lot-report-query";

// The status logic that lived inline in lots/balance/page.tsx before extraction.
function legacyStatus(expDate: Date | null, today: Date) {
  const daysUntil = expDate
    ? Math.ceil((startOfThailandDay(expDate).getTime() - today.getTime()) / 86_400_000)
    : null;
  let rowStatus = "no-exp";
  if (daysUntil !== null) {
    rowStatus = daysUntil < 0 ? "expired" : daysUntil <= 30 ? "expiring" : "ok";
  }
  return { daysUntil, status: rowStatus };
}

test("classifyLotExpiry matches the previous inline Lot Balance status for every boundary", () => {
  const today = parseDateOnlyToDate("2026-09-23");
  const offsets = [-400, -31, -30, -1, 0, 1, 29, 30, 31, 32, 90, 365];
  for (const offset of offsets) {
    const expDay = addThailandDays(today, offset);
    // Same day, but stored at different instants within that Thailand day.
    for (const instant of [expDay, new Date(expDay.getTime() + 1), new Date(expDay.getTime() + 86_399_999)]) {
      assert.deepEqual(
        classifyLotExpiry(startOfThailandDay(instant), today),
        legacyStatus(instant, today),
        `offset ${offset} @ ${instant.toISOString()}`,
      );
    }
  }
  assert.deepEqual(classifyLotExpiry(null, today), legacyStatus(null, today));
  assert.equal(classifyLotExpiry(startOfThailandDay(addThailandDays(today, 30)), today).status, "expiring");
  assert.equal(classifyLotExpiry(startOfThailandDay(addThailandDays(today, 31)), today).status, "ok");
  assert.equal(classifyLotExpiry(startOfThailandDay(addThailandDays(today, -1)), today).status, "expired");
  assert.equal(classifyLotExpiry(today, parseDateOnlyToDate(getThailandDateKey(today))).daysUntil, 0);
});

test("groupLotKeysByProduct selects exactly the same (productId, lotNo) pairs", () => {
  const keys = [
    { productId: "p1", lotNo: "L1" },
    { productId: "p2", lotNo: "L1" },
    { productId: "p1", lotNo: "L2" },
    { productId: "p1", lotNo: "L2" },
  ];
  const filters = groupLotKeysByProduct(keys);
  const expanded = new Set(filters.flatMap((f) => f.lotNo.in.map((lotNo) => lotKeyOf({ productId: f.productId, lotNo }))));
  assert.deepEqual(expanded, new Set(keys.map(lotKeyOf)));
  assert.equal(filters.length, 2);
  assert.deepEqual(groupLotKeysByProduct([]), []);
});

test("chunkLotKeys covers every key once, in order", () => {
  const keys = Array.from({ length: 2501 }, (_, i) => i);
  const chunks = chunkLotKeys(keys);
  assert.deepEqual(chunks.map((c) => c.length), [1000, 1000, 501]);
  assert.deepEqual(chunks.flat(), keys);
  assert.deepEqual(chunkLotKeys([]), []);
});

test("compareLotsByExpiry sorts oldest expiry first with a stable tiebreak", () => {
  const d1 = new Date("2026-01-01T00:00:00+07:00");
  const d2 = new Date("2026-02-01T00:00:00+07:00");
  const lots = [
    { productId: "p2", lotNo: "A", expDate: d1 },
    { productId: "p1", lotNo: "B", expDate: d2 },
    { productId: "p1", lotNo: "B", expDate: d1 },
    { productId: "p1", lotNo: "A", expDate: d1 },
  ];
  assert.deepEqual(
    [...lots].sort(compareLotsByExpiry).map((l) => `${l.productId}${l.lotNo}${l.expDate === d1 ? 1 : 2}`),
    ["p1A1", "p1B1", "p2A1", "p1B2"],
  );
});

test("pageSlice returns the requested page and nothing for an invalid page", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual(pageSlice(items, 1, 50), items.slice(0, 50));
  assert.deepEqual(pageSlice(items, 3, 50), items.slice(100, 120));
  assert.deepEqual(pageSlice(items, 4, 50), []);
  assert.deepEqual(pageSlice(items, Number.NaN, 50), []);
});
