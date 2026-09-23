import test from "node:test";
import assert from "node:assert/strict";

import {
  countsTowardStorefrontCatalogLimit,
  isNextRouterPrefetch,
} from "@/lib/storefront-catalog-rate-limit";

const h = (entries: Record<string, string> = {}) => new Headers(entries);

test("full page loads of catalog paths are counted, exactly as before", () => {
  for (const path of ["/product/abc-123", "/products", "/products/evaporator", "/products/search"]) {
    assert.equal(countsTowardStorefrontCatalogLimit(path, "GET", h()), true, path);
    assert.equal(countsTowardStorefrontCatalogLimit(path, "HEAD", h()), true, path);
  }
});

test("real client navigations (rsc header, no prefetch header) are still counted", () => {
  assert.equal(countsTowardStorefrontCatalogLimit("/product/abc-123", "GET", h({ rsc: "1" })), true);
});

test("Next.js link prefetches are not counted", () => {
  const prefetch = h({ rsc: "1", "next-router-prefetch": "1" });
  const segmentPrefetch = h({ rsc: "1", "next-router-segment-prefetch": "/_tree" });
  assert.equal(countsTowardStorefrontCatalogLimit("/product/abc-123", "GET", prefetch), false);
  assert.equal(countsTowardStorefrontCatalogLimit("/products/evaporator", "GET", segmentPrefetch), false);
  assert.equal(isNextRouterPrefetch(h({ "Next-Router-Prefetch": "1" })), true, "header names are case-insensitive");
});

test("non-catalog paths and non-GET methods are never counted, as before", () => {
  assert.equal(countsTowardStorefrontCatalogLimit("/", "GET", h()), false);
  assert.equal(countsTowardStorefrontCatalogLimit("/productsx", "GET", h()), false);
  assert.equal(countsTowardStorefrontCatalogLimit("/product", "GET", h()), false);
  assert.equal(countsTowardStorefrontCatalogLimit("/product/abc-123", "POST", h()), false);
});
