import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// Glued Thai questions ("มีคอยเย็นมิราจไหมครับ") arrive as one whitespace token, so
// the whitespace dictionary resolver cannot read them. When the LLM classifier is
// down this resolver is the last chance to search instead of handing off — and it
// must stay as strict: anything it cannot read fully, or a mixed question, → null.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type Row = { normalized: string; kind: string; term: string };

const DICTIONARY: Row[] = [
  { normalized: "คอยเย็น", kind: "category", term: "คอยล์เย็น (Evaporator)" },
  { normalized: "คอยเย็น", kind: "synonym", term: "คอยล์เย็น" },
  { normalized: "หม้อน้ำ", kind: "category", term: "หม้อน้ำ (Radiator)" },
  { normalized: "วาล์ว", kind: "category", term: "วาล์ว (Expansion Valve)" },
  { normalized: "มิราจ", kind: "synonym", term: "Mirage" },
  { normalized: "mirage", kind: "carModel", term: "Mirage" },
  { normalized: "วีออส", kind: "synonym", term: "Vios" },
  { normalized: "vios", kind: "carModel", term: "Vios" },
  // A particle that also happens to be a dictionary row must never become a filter.
  { normalized: "ตัว", kind: "product", term: "ตัว" },
];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        $queryRaw: async (query: { strings: readonly string[]; values: unknown[] }) => {
          const wanted = new Set(query.values.map(String));
          const expansionOnly = query.strings.join("").includes("kind IN");
          return DICTIONARY.filter(
            (row) =>
              wanted.has(row.normalized) &&
              (!expansionOnly || ["carModel", "carBrand", "category"].includes(row.kind)),
          );
        },
      },
    },
  });
});

test("reads the production glued question as evaporator + Mirage", { skip: moduleMocksUnavailable }, async () => {
  const { resolveGluedKnownQueryIntent } = await import("@/lib/chat-core/known-query-intent");
  const result = await resolveGluedKnownQueryIntent("มีคอยเย็นมิราจไหมครับ");

  assert.equal(result?.query, "คอยเย็น มิราจ");
  assert.equal(result?.categoryName, "คอยล์เย็น (Evaporator)");
  assert.equal(result?.carModelName, "Mirage");
  assert.equal(result?.contextFree, true);
});

test("matches across an ICU word-boundary cut and keeps a glued year", { skip: moduleMocksUnavailable }, async () => {
  const { resolveGluedKnownQueryIntent } = await import("@/lib/chat-core/known-query-intent");
  // ICU segments "หม้อน้ำวีออสมี" as "หม้อ|น้ำ|วี|ออ|สมี" — the ส belongs to วีออส.
  const radiator = await resolveGluedKnownQueryIntent("หม้อน้ำวีออสปี2010มีไหมครับ");

  assert.equal(radiator?.query, "หม้อน้ำ วีออส 2010");
  assert.equal(radiator?.categoryName, "หม้อน้ำ (Radiator)");
  assert.equal(radiator?.carModelName, "Vios");
  assert.equal(radiator?.fitmentYear, 2010);
});

test("a word the dictionary does not know keeps the query unresolved", { skip: moduleMocksUnavailable }, async () => {
  const { resolveGluedKnownQueryIntent } = await import("@/lib/chat-core/known-query-intent");

  assert.equal(await resolveGluedKnownQueryIntent("ล้างคอยเย็นมิราจไหมครับ"), null, "cleaning service ≠ the coil");
  assert.equal(await resolveGluedKnownQueryIntent("ไม่มีคอยเย็นมิราจหรอครับ"), null);
  assert.equal(await resolveGluedKnownQueryIntent("ครับ"), null);
});

test("a mixed question (two parts or two cars) is left to the hand-off", { skip: moduleMocksUnavailable }, async () => {
  const { resolveGluedKnownQueryIntent } = await import("@/lib/chat-core/known-query-intent");

  assert.equal(await resolveGluedKnownQueryIntent("วาล์วคอยเย็นมิราจ"), null);
  assert.equal(await resolveGluedKnownQueryIntent("คอยเย็นมิราจวีออส"), null);
});

test("a part without a car is resolved but not self-contained", { skip: moduleMocksUnavailable }, async () => {
  const { resolveGluedKnownQueryIntent } = await import("@/lib/chat-core/known-query-intent");
  const result = await resolveGluedKnownQueryIntent("มีคอยเย็นตัวไหมครับ");

  assert.equal(result?.query, "คอยเย็น", "the particle ตัว never becomes a word");
  assert.equal(result?.contextFree, false);
});

test("planGluedQueryWords keeps an unknown code token and drops particles", async () => {
  const { planGluedQueryWords } = await import("@/lib/chat-core/known-query-intent");
  const { splitThaiGraphemes } = await import("@/lib/thai-segment");
  const pieces = [...splitThaiGraphemes("มีคอยเย็น"), "p0368", ...splitThaiGraphemes("ไหมครับ")];

  const words = planGluedQueryWords(
    pieces,
    (norm) => norm === "คอยเย็น",
    (norm) => norm === "p0368",
  );

  assert.deepEqual(words, ["คอยเย็น", "p0368"]);
});
