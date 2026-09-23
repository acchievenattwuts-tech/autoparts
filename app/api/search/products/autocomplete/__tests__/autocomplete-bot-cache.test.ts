import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// The bot path answers the same URL with a different (lighter) result than real
// browsers get, so it must never be written into a shared cache.

let userAgentIsBot = true;

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: { product: { findMany: async () => [] } },
    },
  });
  await mock.module("@/lib/search-bot", {
    namedExports: { isLikelyBotUserAgent: () => userAgentIsBot },
  });
  await mock.module("@/lib/storefront-product-search", {
    namedExports: {
      runStorefrontProductSearchWithRequiredTokenFallback: async () => ({
        searchResult: { ids: [], total: 0 },
      }),
    },
  });
  await mock.module("@/lib/product-search-telemetry", {
    namedExports: { logProductSearchTelemetry: async () => undefined },
  });
});

const request = (ip: string) =>
  new Request("https://example.test/api/search/products/autocomplete?q=vigo", {
    headers: { "user-agent": "Googlebot/2.1", "x-forwarded-for": ip },
  });

test("bot-path autocomplete responses are private (no shared-cache s-maxage)", async () => {
  const { GET } = await import("../route");
  userAgentIsBot = true;
  const response = await GET(request("198.51.100.1"));
  assert.equal(response.status, 200);
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /private/);
  assert.doesNotMatch(cacheControl, /s-maxage|public/);
});

test("browser-path autocomplete keeps its existing shared-cache header", async () => {
  const { GET } = await import("../route");
  userAgentIsBot = false;
  const response = await GET(request("198.51.100.2"));
  assert.equal(response.headers.get("cache-control"), "public, max-age=30, s-maxage=60");
});
