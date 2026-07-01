import test from "node:test";
import assert from "node:assert/strict";

import { isCarYearRangeToken, parseCarYearRangeStart } from "@/lib/car-year-shorthand";

test("recognizes 2- and 4-digit car-year range tokens", () => {
  assert.equal(isCarYearRangeToken("12-15"), true);
  assert.equal(isCarYearRangeToken("2012-2015"), true);
  assert.equal(isCarYearRangeToken("ปี12-15"), true);
  assert.equal(isCarYearRangeToken("98-05"), true); // 1998–2005
});

test("rejects part codes and descending / implausible ranges", () => {
  assert.equal(isCarYearRangeToken("stb-2116"), false);
  assert.equal(isCarYearRangeToken("447220-1234"), false);
  assert.equal(isCarYearRangeToken("15-12"), false); // descending
  assert.equal(isCarYearRangeToken("709"), false);
});

test("parses the START year of a range embedded in free text", () => {
  assert.equal(parseCarYearRangeStart("คอยเย็น Avanza 12-15"), 2012);
  assert.equal(parseCarYearRangeStart("คอยเย็น Avanza 2012-2015"), 2012);
  assert.equal(parseCarYearRangeStart("ปี12-15 vios"), 2012);
  assert.equal(parseCarYearRangeStart("98-05 hilux"), 1998);
});

test("returns null when no range is present", () => {
  assert.equal(parseCarYearRangeStart("คอยเย็น Avanza"), null);
  assert.equal(parseCarYearRangeStart("คอยเย็น 2012"), null);
  assert.equal(parseCarYearRangeStart(""), null);
  assert.equal(parseCarYearRangeStart(null), null);
});
