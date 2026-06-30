import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("cache key folds in the model dimension so a model swap can't serve a stale vector", async () => {
  const { buildQueryEmbeddingCacheKey } = await import("@/lib/embeddings");
  const { GEMINI_EMBEDDING_DIMENSIONS } = await import("@/lib/embeddings");
  const key = buildQueryEmbeddingCacheKey("vios");
  assert.equal(key, `query-embedding:v${GEMINI_EMBEDDING_DIMENSIONS}:vios`);
});

test("distinct queries produce distinct cache keys", async () => {
  const { buildQueryEmbeddingCacheKey } = await import("@/lib/embeddings");
  assert.notEqual(
    buildQueryEmbeddingCacheKey("vios"),
    buildQueryEmbeddingCacheKey("yaris"),
  );
});

test("embedQuery returns null without any API call when semantic search is disabled", async () => {
  // Semantic off by default (no PRODUCT_SEARCH_SEMANTIC=on) → must short-circuit to
  // null so the caller degrades to lexical-only. This preserves the additive,
  // never-worse-than-before contract regardless of the new caching layer.
  delete process.env.PRODUCT_SEARCH_SEMANTIC;
  const { embedQuery } = await import("@/lib/embeddings");
  assert.equal(await embedQuery("vios"), null);
  assert.equal(await embedQuery(""), null);
  assert.equal(await embedQuery(null), null);
  assert.equal(await embedQuery(undefined), null);
});
