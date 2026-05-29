import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function runStorefrontProductSearchCacheChecks() {
  const productsPage = readRepoFile("app/products/page.tsx");
  const searchAction = readRepoFile("app/products/search/search-products-actions.ts");
  const searchHelper = readRepoFile("lib/storefront-product-search.ts");

  expectIncludes(
    searchHelper,
    "unstable_cache",
    "Storefront product search helper must cache repeated search payloads",
  );

  expectIncludes(
    searchHelper,
    "revalidate: 300",
    "Storefront product search helper must revalidate cached search payloads every 300 seconds",
  );

  expectIncludes(
    productsPage,
    "getStorefrontProductSearchPageData",
    "Products page must use the shared cached storefront search helper",
  );

  expectIncludes(
    searchAction,
    "getStorefrontProductSearchPageData",
    "Search server action must use the shared cached storefront search helper",
  );
}

runStorefrontProductSearchCacheChecks();

console.log("Storefront product search cache checks passed");
