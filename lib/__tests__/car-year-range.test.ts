import assert from "node:assert/strict";
import test from "node:test";

import { resolveCarYearRangeFilter, resolveCarYearRangeFilterStrings } from "@/lib/car-year-range";

// ── Golden suite: a half-filled car-year range means ONE model year ──────────
// The engine matches a fitment row that OVERLAPS the requested range, which is
// right for a real range but reads very differently half-filled: production
// 2026-08-02, filtering Blower + Honda Jazz with "ช่วงปีรถ 2010 – (ว่าง)" returned
// parts listed only for Jazz 2014+, because [2014, ∞) genuinely overlaps
// [2010, ∞). One side filled now means that exact year; a range needs both.

test("start only becomes that single model year", () => {
  assert.deepEqual(resolveCarYearRangeFilter(2010, null), { yearMin: 2010, yearMax: 2010 });
  assert.deepEqual(resolveCarYearRangeFilter(2010, undefined), { yearMin: 2010, yearMax: 2010 });
});

test("end only becomes that single model year too (the mirror case)", () => {
  // Kept symmetrical on purpose: if one side meant "exactly this year" and the
  // other still meant "up to this year", the same form would read two ways.
  assert.deepEqual(resolveCarYearRangeFilter(null, 2015), { yearMin: 2015, yearMax: 2015 });
});

test("a real range is passed through untouched", () => {
  assert.deepEqual(resolveCarYearRangeFilter(2010, 2015), { yearMin: 2010, yearMax: 2015 });
  // Even an inverted range stays as typed — validating it is the caller's job,
  // and silently swapping would hide a typo from the person who made it.
  assert.deepEqual(resolveCarYearRangeFilter(2015, 2010), { yearMin: 2015, yearMax: 2010 });
});

test("an empty range stays empty (browsing every year)", () => {
  assert.deepEqual(resolveCarYearRangeFilter(null, null), { yearMin: null, yearMax: null });
  assert.deepEqual(resolveCarYearRangeFilter(undefined, undefined), { yearMin: null, yearMax: null });
});

test("the string form follows the same rule and trims blanks", () => {
  assert.deepEqual(resolveCarYearRangeFilterStrings("2010", undefined), {
    yearMin: "2010",
    yearMax: "2010",
  });
  assert.deepEqual(resolveCarYearRangeFilterStrings(undefined, "2015"), {
    yearMin: "2015",
    yearMax: "2015",
  });
  assert.deepEqual(resolveCarYearRangeFilterStrings("2010", "2015"), {
    yearMin: "2010",
    yearMax: "2015",
  });
  assert.deepEqual(resolveCarYearRangeFilterStrings("  ", "  "), {
    yearMin: undefined,
    yearMax: undefined,
  });
  assert.deepEqual(resolveCarYearRangeFilterStrings(" 2010 ", "   "), {
    yearMin: "2010",
    yearMax: "2010",
  });
});

test("admin filter params apply the rule at parse time", async () => {
  const { parseAdminProductFilterParams } = await import("@/lib/admin-product-filter-params");

  // The exact production URL shape: a start year, no end year.
  assert.deepEqual(
    parseAdminProductFilterParams({ carModelId: "m1", yearMin: "2010" }),
    { carModelId: "m1", yearMin: "2010", yearMax: "2010" },
    "the chips and the query now agree on one model year",
  );
  assert.deepEqual(
    parseAdminProductFilterParams({ yearMax: "2015" }),
    { yearMin: "2015", yearMax: "2015" },
  );
  assert.deepEqual(
    parseAdminProductFilterParams({ yearMin: "2010", yearMax: "2015" }),
    { yearMin: "2010", yearMax: "2015" },
    "an explicit range is untouched",
  );
  assert.deepEqual(
    parseAdminProductFilterParams({ search: "vios" }),
    { search: "vios" },
    "no year params, no year keys added",
  );
});
