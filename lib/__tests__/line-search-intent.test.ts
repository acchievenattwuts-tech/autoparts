import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("parses a clean JSON intent object", async () => {
  const { parseLineSearchIntent } = await import("@/lib/line-ai-service");
  const intent = parseLineSearchIntent(
    '{"query":"หม้อน้ำ mazda 2","partType":"หม้อน้ำ","carBrand":"Mazda","carModel":"Mazda 2","year":2015}',
  );
  assert.deepEqual(intent, {
    query: "หม้อน้ำ mazda 2",
    partType: "หม้อน้ำ",
    carBrand: "Mazda",
    carModel: "Mazda 2",
    year: 2015,
  });
});

test("tolerates markdown fences and surrounding prose", async () => {
  const { parseLineSearchIntent } = await import("@/lib/line-ai-service");
  const intent = parseLineSearchIntent('```json\n{"query":"คอยล์เย็น vios","year":null}\n```');
  assert.equal(intent?.query, "คอยล์เย็น vios");
  assert.equal(intent?.year, null);
});

test("normalizes 'null' strings and out-of-range years to null", async () => {
  const { parseLineSearchIntent } = await import("@/lib/line-ai-service");
  const intent = parseLineSearchIntent(
    '{"query":"กรองแอร์ vigo","carBrand":"null","carModel":"","year":"99"}',
  );
  assert.equal(intent?.carBrand, null);
  assert.equal(intent?.carModel, null);
  assert.equal(intent?.year, null);
});

test("returns null when there is no usable query", async () => {
  const { parseLineSearchIntent } = await import("@/lib/line-ai-service");
  assert.equal(parseLineSearchIntent('{"query":null}'), null);
  assert.equal(parseLineSearchIntent("not json at all"), null);
  assert.equal(parseLineSearchIntent(""), null);
});
