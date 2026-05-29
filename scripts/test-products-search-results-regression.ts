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

function expectExcludes(source: string, needle: string, message: string) {
  assert.ok(!source.includes(needle), message);
}

function runProductsSearchRegressionChecks() {
  const productsPage = readRepoFile("app/products/page.tsx");
  const searchResults = readRepoFile("app/products/search/SearchResults.tsx");
  const searchAction = readRepoFile("app/products/search/search-products-actions.ts");

  expectIncludes(
    searchResults,
    "router.replace(url, { scroll: false })",
    "SearchResults must keep router.replace so Next router state stays in sync with AJAX filter URLs",
  );

  expectIncludes(
    searchResults,
    "renderNonce",
    "SearchResults must keep renderNonce-based reset handling for external navigations",
  );

  expectIncludes(
    searchResults,
    'import type { SearchProductItem } from "@/lib/storefront-product-search";',
    "SearchResults must import SearchProductItem from the shared helper module, not from the server action module",
  );

  expectIncludes(
    productsPage,
    'export const revalidate = 300;',
    "Products page must use ISR revalidation for Option A",
  );

  expectExcludes(
    productsPage,
    'export const dynamic = "force-dynamic";',
    "Products page must not force dynamic rendering in Option A",
  );

  expectExcludes(
    productsPage,
    "<SearchResults\n            key={searchResultsKey}",
    "Products page must not key SearchResults by filters because that forces remounts during AJAX filter navigations",
  );

  expectExcludes(
    productsPage,
    "const searchResultsKey = [",
    "Products page must not derive a filter-based remount key for SearchResults",
  );

  expectExcludes(
    searchAction,
    "export type { SearchProductItem, SearchProductsResult };",
    "Server action module must not re-export SearchProductItem/SearchProductsResult because the action loader can treat them as runtime exports",
  );
}

runProductsSearchRegressionChecks();

console.log("Products search regression checks passed");
