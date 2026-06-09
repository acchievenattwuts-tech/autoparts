import test from "node:test";
import assert from "node:assert/strict";

// product-search.ts pulls in the db client at module load; give it a dummy URL
// (no query ever runs — buildTsQueryExpression is a pure string builder).
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("AND-joins distinct concepts so all must match", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  const groups = [["หม้อน้ำ"], ["mazda"], ["2"]];
  assert.equal(buildTsQueryExpression(groups, "and"), "((หม้อน้ำ:*)) & ((mazda:*)) & ((2))");
});

test("OR-joins concepts in fallback mode", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  const groups = [["หม้อน้ำ"], ["mazda"], ["2"]];
  assert.equal(buildTsQueryExpression(groups, "or"), "((หม้อน้ำ:*)) | ((mazda:*)) | ((2))");
});

test("short bare numbers are exact lexemes, not prefix (no '2:*')", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  // The "2" in "Mazda 2" must not prefix-match every 20xx year token.
  const expr = buildTsQueryExpression([["2"]], "and");
  assert.equal(expr, "((2))");
  assert.ok(!expr.includes("2:*"));
});

test("multi-digit numbers (years) keep prefix matching", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  assert.equal(buildTsQueryExpression([["2015"]], "and"), "((2015:*))");
});

test("synonyms within a concept are OR'd, concepts AND'd", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  const groups = [["คอมแอร์", "compressor"], ["vios"]];
  assert.equal(
    buildTsQueryExpression(groups, "and"),
    "((คอมแอร์:*) | (compressor:*)) & ((vios:*))",
  );
});

test("sanitizes punctuation and drops empty groups", async () => {
  const { buildTsQueryExpression } = await import("@/lib/product-search");
  // Hyphen is a permitted lexeme char (kept as one token); the "!!!" group
  // sanitizes to nothing and is dropped entirely.
  assert.equal(buildTsQueryExpression([["d-max"], ["!!!"]], "and"), "((d-max:*))");
  assert.equal(buildTsQueryExpression([], "and"), "");
});
