import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type SearchFallbackFn = NonNullable<
  Parameters<
    typeof import("@/lib/storefront-product-search").runStorefrontProductSearchWithRequiredTokenFallback
  >[1]
>;
type SearchResult = Awaited<ReturnType<SearchFallbackFn>>;

test("storefront search tries required tokens first and falls back when strict search is empty", async () => {
  const { runStorefrontProductSearchWithRequiredTokenFallback } = await import(
    "@/lib/storefront-product-search"
  );
  const calls: unknown[] = [];
  const searchFn: SearchFallbackFn = async (input): Promise<SearchResult> => {
    calls.push(input);
    if (calls.length === 1) {
      return { ids: [], total: 0, mode: "v2", matchReasons: {} };
    }
    return { ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } };
  };
  const result = await runStorefrontProductSearchWithRequiredTokenFallback(
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
    searchFn,
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
  const searchFn: SearchFallbackFn = async (input): Promise<SearchResult> => {
    calls.push(input);
    return { ids: ["p1"], total: 1, mode: "v2", matchReasons: { p1: ["name"] } };
  };
  const result = await runStorefrontProductSearchWithRequiredTokenFallback(
    {
      query: "คอม dragon 709",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
    searchFn,
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(result.requiredTokenFallback, {
    requiredTokens: ["709"],
    usedFallback: false,
  });
});
