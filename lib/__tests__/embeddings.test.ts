import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("toPgVectorLiteral formats a vector as a pgvector literal", async () => {
  const { toPgVectorLiteral } = await import("@/lib/embeddings");
  assert.equal(toPgVectorLiteral([0.1, -0.2, 0.3]), "[0.1,-0.2,0.3]");
  assert.equal(toPgVectorLiteral([]), "[]");
});

test("buildProductEmbeddingText joins present fields and drops empties", async () => {
  const { buildProductEmbeddingText } = await import("@/lib/embeddings");
  const text = buildProductEmbeddingText({
    productName: "คอยล์เย็น D-Max",
    categoryName: "คอยล์เย็น",
    brandName: null,
    carText: "Isuzu D-Max",
    fitmentText: "2012-2018",
    keywordText: "",
  });
  assert.equal(text, "คอยล์เย็น D-Max • คอยล์เย็น • Isuzu D-Max • 2012-2018");
});

test("buildProductEmbeddingText collapses whitespace", async () => {
  const { buildProductEmbeddingText } = await import("@/lib/embeddings");
  const text = buildProductEmbeddingText({ productName: "  หม้อน้ำ   Mazda  2 " });
  assert.equal(text, "หม้อน้ำ Mazda 2");
});

test("product embedding source hash is deterministic and content-sensitive", async () => {
  const { buildProductEmbeddingSourceHash } = await import("@/lib/embeddings");
  assert.equal(
    buildProductEmbeddingSourceHash("หม้อน้ำ Mazda 2"),
    buildProductEmbeddingSourceHash("หม้อน้ำ   Mazda 2"),
  );
  assert.notEqual(
    buildProductEmbeddingSourceHash("หม้อน้ำ Mazda 2"),
    buildProductEmbeddingSourceHash("คอยล์เย็น Mazda 2"),
  );
});

test("isSemanticSearchEnabled is off without the flag", async () => {
  const { isSemanticSearchEnabled } = await import("@/lib/embeddings");
  const prev = process.env.PRODUCT_SEARCH_SEMANTIC;
  delete process.env.PRODUCT_SEARCH_SEMANTIC;
  assert.equal(isSemanticSearchEnabled(), false);
  if (prev !== undefined) process.env.PRODUCT_SEARCH_SEMANTIC = prev;
});
