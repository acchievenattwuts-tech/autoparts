import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("storefront search tries required tokens first and falls back when strict search is empty", async () => {
  const { runStorefrontProductSearchWithRequiredTokenFallback } = await import(
    "@/lib/storefront-product-search"
  );
  const calls: unknown[] = [];
  const result = await runStorefrontProductSearchWithRequiredTokenFallback(
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
    async (input) => {
      calls.push(input);
      return calls.length === 1
        ? { ids: [], total: 0, mode: "v2", matchReasons: {} }
        : { ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } };
    },
  );

  assert.deepEqual(calls, [
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
      requiredTokens: ["709"],
    },
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
  ]);
  assert.equal(result.searchResult.total, 1);
  assert.deepEqual(result.requiredTokenFallback, {
    requiredTokens: ["709"],
    usedFallback: true,
  });
});

test("storefront search does not fall back when strict required-token search has results", async () => {
  const { runStorefrontProductSearchWithRequiredTokenFallback } = await import(
    "@/lib/storefront-product-search"
  );
  const calls: unknown[] = [];
  const result = await runStorefrontProductSearchWithRequiredTokenFallback(
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
    async (input) => {
      calls.push(input);
      return { ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } };
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(result.requiredTokenFallback, {
    requiredTokens: ["709"],
    usedFallback: false,
  });
});
