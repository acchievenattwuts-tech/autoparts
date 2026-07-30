import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("adaptive recall skips semantic work when lexical results are sufficient", async () => {
  const { shouldUseSemanticRecall } = await import("@/lib/product-search");
  assert.equal(
    shouldUseSemanticRecall({ lexicalResultCount: 5, take: 30, disabled: false, isYearOnly: false }),
    false,
  );
});

test("adaptive recall rescues low/no-result lexical searches", async () => {
  const { shouldUseSemanticRecall } = await import("@/lib/product-search");
  assert.equal(
    shouldUseSemanticRecall({ lexicalResultCount: 0, take: 30, disabled: false, isYearOnly: false }),
    true,
  );
  assert.equal(
    shouldUseSemanticRecall({ lexicalResultCount: 1, take: 30, disabled: false, isYearOnly: false }),
    true,
  );
});

test("adaptive recall respects semantic and year-only guards", async () => {
  const { shouldUseSemanticRecall } = await import("@/lib/product-search");
  assert.equal(
    shouldUseSemanticRecall({ lexicalResultCount: 0, take: 30, disabled: true, isYearOnly: false }),
    false,
  );
  assert.equal(
    shouldUseSemanticRecall({ lexicalResultCount: 0, take: 30, disabled: false, isYearOnly: true }),
    false,
  );
});
