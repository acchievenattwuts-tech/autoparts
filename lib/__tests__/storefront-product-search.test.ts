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

test("A-light: glued Thai compound is segmented into required tokens (with fallback)", async () => {
  const { runStorefrontProductSearchWithRequiredTokenFallback } = await import(
    "@/lib/storefront-product-search"
  );
  const calls: Array<{ requiredTokens?: string[] }> = [];
  const searchFn: SearchFallbackFn = async (input): Promise<SearchResult> => {
    calls.push(input as { requiredTokens?: string[] });
    // strict (1st) returns the cleaner; no fallback needed.
    return { ids: ["p0482"], total: 1, mode: "v2", matchReasons: { p0482: ["name"] } };
  };
  const result = await runStorefrontProductSearchWithRequiredTokenFallback(
    {
      query: "น้ำยาล้างคอยเย็น",
      isActive: true,
      skip: 0,
      take: 24,
      order: "createdAtDesc",
      cacheProfile: "storefront",
    },
    searchFn,
  );

  assert.equal(calls.length, 1, "strict search returned results, so no fallback");
  const used = calls[0].requiredTokens ?? [];
  assert.ok(used.length >= 2, `expected segmented Thai required tokens, got ${JSON.stringify(used)}`);
  assert.ok(used.includes("ล้าง"), `expected "ล้าง" anchor in ${JSON.stringify(used)}`);
  assert.equal(result.searchResult.total, 1);
  assert.equal(result.requiredTokenFallback?.usedFallback, false);
});
