import assert from "node:assert/strict";
import test from "node:test";

import { getThailandDateKey, isThailandMonthEndDateKey } from "@/lib/th-date";

test("getThailandDateKey accepts serialized Date strings from cached data", () => {
  assert.equal(getThailandDateKey("2026-06-25T02:30:00.000Z"), "2026-06-25");
});

test("isThailandMonthEndDateKey flags only the last day of each month", () => {
  assert.equal(isThailandMonthEndDateKey("2026-08-31"), true);
  assert.equal(isThailandMonthEndDateKey("2026-08-30"), false);
  assert.equal(isThailandMonthEndDateKey("2026-09-30"), true);
  assert.equal(isThailandMonthEndDateKey("2026-09-01"), false);
  assert.equal(isThailandMonthEndDateKey("2026-12-31"), true);
  assert.equal(isThailandMonthEndDateKey("2026-02-28"), true);
  assert.equal(isThailandMonthEndDateKey("2024-02-28"), false);
  assert.equal(isThailandMonthEndDateKey("2024-02-29"), true);
});
