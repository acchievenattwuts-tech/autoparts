import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

let rateLimitImpl: (options: { key: string; limit: number; windowMs: number }) => Promise<{
  ok: boolean;
}> = async () => ({ ok: true });
const seenOptions: Array<{ key: string; limit: number; windowMs: number }> = [];

before(async () => {
  await mock.module("next/headers", {
    namedExports: {
      headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    },
  });
  await mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async (options: { key: string; limit: number; windowMs: number }) => {
        seenOptions.push(options);
        return rateLimitImpl(options);
      },
    },
  });
});

beforeEach(() => {
  seenOptions.length = 0;
  rateLimitImpl = async () => ({ ok: true });
  mock.method(console, "error", () => undefined);
});

test("buckets load-more per client IP, separately from storefront search", async () => {
  const { allowStorefrontLoadMore, STOREFRONT_LOAD_MORE_RATE_LIMIT_PER_MINUTE } = await import(
    "@/lib/storefront-load-more-guard"
  );
  assert.equal(await allowStorefrontLoadMore("test"), true);
  assert.deepEqual(seenOptions, [
    {
      key: "storefront-loadmore:203.0.113.7",
      limit: STOREFRONT_LOAD_MORE_RATE_LIMIT_PER_MINUTE,
      windowMs: 60_000,
    },
  ]);
});

test("refuses once the ceiling is reached", async () => {
  const { allowStorefrontLoadMore } = await import("@/lib/storefront-load-more-guard");
  rateLimitImpl = async () => ({ ok: false });
  assert.equal(await allowStorefrontLoadMore("test"), false);
});

test("fails open when the throttle table is unreachable", async () => {
  const { allowStorefrontLoadMore } = await import("@/lib/storefront-load-more-guard");
  rateLimitImpl = async () => {
    throw new Error("connection refused");
  };
  assert.equal(await allowStorefrontLoadMore("test"), true);
});
