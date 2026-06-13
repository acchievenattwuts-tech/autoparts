import test from "node:test";
import assert from "node:assert/strict";

test("segments a glued Thai compound into words", async () => {
  const { segmentThaiQueryTokens } = await import("@/lib/thai-segment");
  const tokens = segmentThaiQueryTokens("น้ำยาล้างคอยเย็น");
  // ICU may split "คอยเย็น" as คอย/เย็น; we assert the discriminating heads are present.
  assert.ok(tokens.length >= 2, `expected >=2 tokens, got ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes("ล้าง"), `expected "ล้าง" in ${JSON.stringify(tokens)}`);
  assert.ok(tokens.includes("เย็น"), `expected "เย็น" in ${JSON.stringify(tokens)}`);
});

test("returns [] for non-Thai / empty queries (no behaviour change)", async () => {
  const { segmentThaiQueryTokens } = await import("@/lib/thai-segment");
  assert.deepEqual(segmentThaiQueryTokens("EVA111220"), []);
  assert.deepEqual(segmentThaiQueryTokens("dragon 709"), []);
  assert.deepEqual(segmentThaiQueryTokens(""), []);
  assert.deepEqual(segmentThaiQueryTokens(null), []);
});

test("drops stopwords and <2-char fragments", async () => {
  const { segmentThaiQueryTokens } = await import("@/lib/thai-segment");
  const tokens = segmentThaiQueryTokens("กรองแอร์สำหรับวีออส");
  assert.ok(!tokens.includes("สำหรับ"), `stopword leaked: ${JSON.stringify(tokens)}`);
});
