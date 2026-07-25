import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("parses a product classification with consolidated query", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"หม้อน้ำ mazda 2","partType":"หม้อน้ำ","carBrand":"Mazda","carModel":"Mazda 2","year":2015,"partKind":"fitment","tooBroad":false}',
  );
  assert.deepEqual(intent, {
    group: "product",
    query: "หม้อน้ำ mazda 2",
    isProductQuery: true,
    partType: "หม้อน้ำ",
    carBrand: "Mazda",
    carModel: "Mazda 2",
    // Absent from the reply (an older/looser model output) → null, i.e. "unknown
    // whether the latest message named the car" → carry-over behaves as before.
    carMentionInLatest: null,
    year: 2015,
    partKind: "fitment",
    tooBroad: false,
  });
});

test("parses carMentionInLatest — the customer's own words for the car this turn", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"พัดลม honda city","partType":"พัดลม","carBrand":"Honda","carModel":"City","carMentionInLatest":"ซิ้ตี้","year":2012,"partKind":"fitment","tooBroad":false}',
  );
  assert.equal(intent?.carMentionInLatest, "ซิ้ตี้");
});

test("carMentionInLatest: a 'null' string is normalized to null (no car named this turn)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"หม้อน้ำ","partType":"หม้อน้ำ","carMentionInLatest":"null","partKind":"fitment","tooBroad":false}',
  );
  assert.equal(intent?.carMentionInLatest, null);
});

test("parses partKind=universal and tooBroad flag", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"น้ำยาล้างคอยล์","partType":"น้ำยาล้างคอยล์","partKind":"universal","tooBroad":false}',
  );
  assert.equal(intent?.partKind, "universal");
  assert.equal(intent?.tooBroad, false);
});

test("partKind/tooBroad ignored for non-product groups", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent('{"group":"shop_info","partKind":"fitment","tooBroad":true}');
  assert.equal(intent?.partKind, null);
  assert.equal(intent?.tooBroad, false);
});

test("non-product group is valid with no query (isProductQuery false)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent('{"group":"shop_info","query":null}');
  assert.equal(intent?.group, "shop_info");
  assert.equal(intent?.isProductQuery, false);
  assert.equal(intent?.query, "");
});

test("unknown/missing group falls back to 'other' (never guessed as product)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  assert.equal(parseChatSearchIntent('{"query":"อะไรสักอย่าง"}')?.group, "other");
  assert.equal(parseChatSearchIntent('{"group":"weird"}')?.group, "other");
});

test("back-compat: isProductQuery true → product, false → other", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  assert.equal(parseChatSearchIntent('{"isProductQuery":true,"query":"คอยล์เย็น vios"}')?.group, "product");
  assert.equal(parseChatSearchIntent('{"isProductQuery":false}')?.group, "other");
});

test("tolerates markdown fences and surrounding prose", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent('```json\n{"group":"product","query":"คอยล์เย็น vios","year":null}\n```');
  assert.equal(intent?.query, "คอยล์เย็น vios");
  assert.equal(intent?.year, null);
});

test("normalizes 'null' strings and out-of-range years to null", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"กรองแอร์ vigo","carBrand":"null","carModel":"","year":"99"}',
  );
  assert.equal(intent?.carBrand, null);
  assert.equal(intent?.carModel, null);
  assert.equal(intent?.year, null);
});

test("folds a Buddhist-era year to Gregorian (DB stores ค.ศ.)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  // Customer/LLM gave พ.ศ. 2560 → must search as ค.ศ. 2017.
  const be = parseChatSearchIntent('{"group":"product","query":"คอยล์เย็น vios","year":2560}');
  assert.equal(be?.year, 2017);
  // A normal ค.ศ. year is untouched.
  const ce = parseChatSearchIntent('{"group":"product","query":"คอยล์เย็น vios","year":2015}');
  assert.equal(ce?.year, 2015);
});

test("returns null only when the reply isn't parseable JSON", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  assert.equal(parseChatSearchIntent("not json at all"), null);
  assert.equal(parseChatSearchIntent(""), null);
});

test("parses subjects[] when ≥2 distinct part types are listed (B2c)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const intent = parseChatSearchIntent(
    '{"group":"product","query":"คอมแอร์ คอยเย็น d-max","partType":"คอมแอร์","carModel":"D-Max","subjects":[{"partType":"คอมแอร์","carModel":"D-Max","query":"คอมแอร์ D-Max","partKind":"fitment"},{"partType":"คอยเย็น","carModel":"D-Max","query":"คอยเย็น D-Max","partKind":"fitment"}]}',
  );
  assert.equal(intent?.subjects?.length, 2);
  assert.equal(intent?.subjects?.[0].partType, "คอมแอร์");
  assert.equal(intent?.subjects?.[1].partType, "คอยเย็น");
  // Top-level fields still mirror the primary subject (back-compat).
  assert.equal(intent?.partType, "คอมแอร์");
});

test("ignores subjects[] with fewer than 2 real entries (single subject)", async () => {
  const { parseChatSearchIntent } = await import("@/lib/chat-core/ai-service");
  const single = parseChatSearchIntent('{"group":"product","query":"คอยเย็น d-max","partType":"คอยเย็น","subjects":[]}');
  assert.equal(single?.subjects, undefined);
  // entries without a partType are noise and don't count toward the ≥2 threshold
  const noisy = parseChatSearchIntent(
    '{"group":"product","query":"คอยเย็น","partType":"คอยเย็น","subjects":[{"partType":"คอยเย็น","query":"คอยเย็น"},{"partType":null,"query":"อันนี้"}]}',
  );
  assert.equal(noisy?.subjects, undefined);
});
