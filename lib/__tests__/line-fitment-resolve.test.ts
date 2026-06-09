import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("maps colloquial part-types to the right category hint", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/line-fitment-resolve");
  assert.equal(matchPartTypeToCategoryHint("วาล์วแอร์"), "(Expansion Valve)");
  assert.equal(matchPartTypeToCategoryHint("คอยเย็น"), "(Evaporator)");
  assert.equal(matchPartTypeToCategoryHint("คอยล์เย็น"), "(Evaporator)");
  assert.equal(matchPartTypeToCategoryHint("แผงแอร์"), "(Condenser)");
  assert.equal(matchPartTypeToCategoryHint("คอมแอร์"), "(Compressor)");
  assert.equal(matchPartTypeToCategoryHint("กรองแอร์"), "Cabin air filter");
});

test("disambiguates overlapping substrings via ordering", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/line-fitment-resolve");
  // "วาล์ว" appears in two categories — control valve must win when explicit.
  assert.equal(matchPartTypeToCategoryHint("คอนโทรลวาล์วคอมแอร์"), "Compressor Control Valve");
  // "หม้อน้ำ" appears in Radiator / Radiator Cap / Coolant — specifics win.
  assert.equal(matchPartTypeToCategoryHint("ฝาปิดหม้อน้ำ"), "Radiator Cap");
  assert.equal(matchPartTypeToCategoryHint("น้ำยาหล่อเย็นหม้อน้ำ"), "Radiator Coolant");
  assert.equal(matchPartTypeToCategoryHint("หม้อน้ำ"), "(Radiator)");
  // "คอม" specifics win over the generic compressor.
  assert.equal(matchPartTypeToCategoryHint("น้ำมันคอมแอร์"), "Compressor Oil");
  assert.equal(matchPartTypeToCategoryHint("หน้าครัชคอมแอร์"), "Compressor Clutch");
});

test("returns null for unknown / empty part-types", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/line-fitment-resolve");
  assert.equal(matchPartTypeToCategoryHint("อะไหล่แปลกๆ"), null);
  assert.equal(matchPartTypeToCategoryHint(""), null);
  assert.equal(matchPartTypeToCategoryHint(null), null);
});
