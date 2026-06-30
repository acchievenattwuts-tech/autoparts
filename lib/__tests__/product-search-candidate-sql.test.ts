import test from "node:test";
import assert from "node:assert/strict";

// product-search.ts loads the db client at import; supply a dummy URL. No query
// ever runs — buildCandidateTextMatchSql is a pure Prisma.Sql string builder.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const buildFragment = async () => {
  const { buildCandidateTextMatchSql } = await import("@/lib/product-search");
  const { Prisma } = await import("@/lib/generated/prisma");
  return buildCandidateTextMatchSql({
    normalizedQuery: "vios",
    prefixQuery: "vios%",
    containsQuery: "%vios%",
    ts: Prisma.sql`to_tsquery('simple', 'vios')`,
  });
};

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

test("candidate OR uses the GIN-indexable `%` operator on all 4 similarity columns", async () => {
  const frag = await buildFragment();
  // One `%` trigram probe per similarity column (code/oem/name/search_text).
  assert.equal(occurrences(frag.sql, " % "), 4);
  // Each `%` is paired with the per-column similarity floor re-check (identical set).
  assert.equal(occurrences(frag.sql, "similarity("), 4);
});

test("candidate OR drops the subsumed equality + alias branches (no seq-scan predicates)", async () => {
  const frag = await buildFragment();
  // Equality predicates (`= f_unaccent(...)`) were subsumed by the prefix LIKE and
  // removed — none must remain in the candidate clause.
  assert.equal(frag.sql.includes(" = f_unaccent"), false);
  // alias_text was subsumed by search_text (which concats alias_text) and removed.
  assert.equal(frag.sql.includes("psd.alias_text"), false);
});

test("candidate OR keeps the indexable lexical + full-text branches", async () => {
  const frag = await buildFragment();
  assert.ok(frag.sql.includes("psd.product_code")); // prefix LIKE + % probe
  assert.ok(frag.sql.includes("psd.product_name"));
  assert.ok(frag.sql.includes("psd.oem_text"));
  assert.ok(frag.sql.includes("psd.keyword_text"));
  assert.ok(frag.sql.includes("psd.search_text"));
  assert.ok(frag.sql.includes("psd.search_document @@"));
  assert.ok(frag.sql.includes("LIKE"));
});

test("candidate trigram threshold is the minimum of the four similarity floors", async () => {
  const { SEARCH_V2_TRGM_CANDIDATE_THRESHOLD } = await import("@/lib/product-search");
  // min(0.2, 0.2, 0.18, 0.12) — the broadest gate so `%` never excludes a row the
  // per-column `similarity() >= floor` re-check would have admitted.
  assert.equal(SEARCH_V2_TRGM_CANDIDATE_THRESHOLD, "0.12");
});

test("HNSW ef_search is raised above the pgvector default (40) for filtered recall", async () => {
  const { SEARCH_V2_HNSW_EF_SEARCH } = await import("@/lib/product-search");
  assert.equal(SEARCH_V2_HNSW_EF_SEARCH, "100");
  assert.ok(Number(SEARCH_V2_HNSW_EF_SEARCH) > 40);
});
