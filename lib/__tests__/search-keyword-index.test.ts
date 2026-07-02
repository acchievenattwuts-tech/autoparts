import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("synonym aliases are indexed as lookup keys for their canonical term", async () => {
  const { buildSynonymKeywordDrafts } = await import("@/lib/search-keyword-index");

  const rows = buildSynonymKeywordDrafts([{ term: "D-Max", synonyms: ["ออนิว", "All New"] }]);

  assert.deepEqual(
    rows.map((row) => ({ term: row.term, normalized: row.normalized, kind: row.kind })),
    [
      { term: "D-Max", normalized: "d-max", kind: "synonym" },
      { term: "D-Max", normalized: "ออนิว", kind: "synonym" },
      { term: "D-Max", normalized: "all new", kind: "synonym" },
    ],
  );
});
