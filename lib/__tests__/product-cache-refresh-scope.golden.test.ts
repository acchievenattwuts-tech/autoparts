import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { before, mock } from "node:test";

import {
  FULL_PRODUCT_CACHE_REFRESH,
  SEARCH_KEYWORD_PRODUCT_FIELDS,
  STOREFRONT_HIDDEN_PRODUCT_FIELDS,
  TRANSACTION_CATALOG_PRODUCT_FIELDS,
  listChangedSnapshotFields,
  resolveProductCacheRefreshScope,
} from "@/lib/product-cache-refresh-scope";

// Golden + guard tests for the product-save cache scope (egress review 2026-10-05).
// The decision table replays the real change sets of 2026-10-03, when 92 product saves
// each rebuilt the keyword index and expired every storefront cache.

const repoRoot = process.cwd();

type FindManyArgs = { where?: Record<string, unknown>; select?: Record<string, unknown> };
const productFindManyCalls: FindManyArgs[] = [];
const rawSqlCalls: string[] = [];
const emptyFindMany = async (): Promise<unknown[]> => [];

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        category: { findMany: emptyFindMany },
        categoryAlias: { findMany: emptyFindMany },
        partsBrand: { findMany: emptyFindMany },
        carBrand: { findMany: emptyFindMany },
        carModel: { findMany: emptyFindMany },
        product: {
          findMany: async (args: FindManyArgs): Promise<unknown[]> => {
            productFindManyCalls.push(args);
            return [];
          },
        },
        searchSynonym: { findMany: emptyFindMany },
        productSearchLog: { findMany: emptyFindMany },
        $queryRaw: async (strings: TemplateStringsArray): Promise<unknown[]> => {
          rawSqlCalls.push(strings.join("?"));
          return [];
        },
      },
      isTransientDbError: () => false,
      withDbRetry: <R>(fn: () => Promise<R>): Promise<R> => fn(),
    },
  });
});

const GOLDEN_CHANGE_SETS: Array<{
  name: string;
  changed: string[] | null;
  expected: { storefrontWide: boolean; searchKeywordIndex: boolean; transactionProductCatalog: boolean };
}> = [
  // 36 saves at 09:00 on 2026-10-03: member price + price-list prices only.
  { name: "price-list only", changed: ["memberPrice", "priceListPrices"], expected: { storefrontWide: false, searchKeywordIndex: false, transactionProductCatalog: false } },
  // 27 saves: retail price moves too, which product cards show.
  {
    name: "retail + sale + member + price lists",
    changed: ["memberPrice", "priceListPrices", "retailPrice", "salePrice"],
    expected: { storefrontWide: true, searchKeywordIndex: false, transactionProductCatalog: false },
  },
  { name: "wholesale + cost only", changed: ["costPrice", "salePrice"], expected: { storefrontWide: false, searchKeywordIndex: false, transactionProductCatalog: false } },
  {
    name: "stock control + purchasing defaults",
    changed: ["minStock", "preferredSupplierId", "purchaseUnitName", "reportUnitName", "shelfLocation", "units"],
    expected: { storefrontWide: false, searchKeywordIndex: false, transactionProductCatalog: false },
  },
  {
    name: "lot policy",
    changed: ["allowExpiredIssue", "isLotControl", "lotIssueMethod", "requireExpiryDate"],
    expected: { storefrontWide: false, searchKeywordIndex: false, transactionProductCatalog: false },
  },
  { name: "rename", changed: ["name"], expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: true } },
  { name: "rename + description", changed: ["description", "name"], expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: true } },
  {
    name: "catalogue rework (12:00–18:00 edits)",
    changed: ["aliases", "description", "fitments", "imageUrl", "name", "productImages"],
    expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: true },
  },
  { name: "description only", changed: ["description"], expected: { storefrontWide: true, searchKeywordIndex: false, transactionProductCatalog: true } },
  { name: "warranty days (STAL bulk change)", changed: ["warrantyDays"], expected: { storefrontWide: true, searchKeywordIndex: false, transactionProductCatalog: false } },
  { name: "hide from storefront", changed: ["isStorefrontVisible"], expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: false } },
  { name: "reactivate", changed: ["isActive"], expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: true } },
  { name: "price list + rename", changed: ["name", "priceListPrices"], expected: { storefrontWide: true, searchKeywordIndex: true, transactionProductCatalog: true } },
  { name: "saved without changes", changed: [], expected: { storefrontWide: false, searchKeywordIndex: false, transactionProductCatalog: false } },
  { name: "unknown future field is treated as storefront-visible", changed: ["someNewField"], expected: { storefrontWide: true, searchKeywordIndex: false, transactionProductCatalog: false } },
  { name: "diff unavailable refreshes everything", changed: null, expected: FULL_PRODUCT_CACHE_REFRESH },
];

for (const { name, changed, expected } of GOLDEN_CHANGE_SETS) {
  test(`cache scope golden: ${name}`, () => {
    assert.deepEqual(resolveProductCacheRefreshScope(changed), expected);
  });
}

test("changed fields come from both sides of the diff and ignore non-object diffs", () => {
  assert.deepEqual(
    listChangedSnapshotFields({ before: { salePrice: "10", name: "A" }, after: { salePrice: "12", aliases: [] } }),
    ["aliases", "name", "salePrice"],
  );
  assert.deepEqual(listChangedSnapshotFields({ before: {}, after: {} }), []);
  assert.equal(listChangedSnapshotFields({ before: null, after: { name: "A" } }), null);
  assert.equal(listChangedSnapshotFields({ before: ["a"], after: ["b"] }), null);
});

test("SEARCH_KEYWORD_PRODUCT_FIELDS matches the product columns buildSearchKeywordRows reads", async () => {
  const { buildSearchKeywordRows } = await import("@/lib/search-keyword-index");
  productFindManyCalls.length = 0;
  await buildSearchKeywordRows();

  assert.equal(productFindManyCalls.length, 1, "the keyword build reads products exactly once");
  const [call] = productFindManyCalls;
  const readColumns = [...Object.keys(call.where ?? {}), ...Object.keys(call.select ?? {})];
  assert.deepEqual(
    [...new Set(readColumns)].sort(),
    [...SEARCH_KEYWORD_PRODUCT_FIELDS].sort(),
    "update SEARCH_KEYWORD_PRODUCT_FIELDS in lib/product-cache-refresh-scope.ts together with the keyword query",
  );
});

test("TRANSACTION_CATALOG_PRODUCT_FIELDS matches what the picker catalog loads", async () => {
  const { buildTransactionProductCatalog } = await import("@/lib/transaction-product-search");
  productFindManyCalls.length = 0;
  rawSqlCalls.length = 0;
  await buildTransactionProductCatalog();

  assert.equal(productFindManyCalls.length, 1, "the catalog reads the product master once");
  // Relation selects map to the snapshot's foreign-key fields.
  const relationToSnapshotField: Record<string, string> = { category: "categoryId", brand: "brandId" };
  const fromProductQuery = Object.keys(productFindManyCalls[0].select ?? {})
    .filter((key) => key !== "id")
    .map((key) => relationToSnapshotField[key] ?? key);
  const fromRawQueries = [
    ...(rawSqlCalls.some((sql) => /\bdescription\b/.test(sql) && /FROM "Product"/.test(sql)) ? ["description"] : []),
    ...(rawSqlCalls.some((sql) => /FROM "ProductAlias"/.test(sql)) ? ["aliases"] : []),
  ];
  assert.deepEqual(
    [...new Set([...fromProductQuery, ...fromRawQueries])].sort(),
    [...TRANSACTION_CATALOG_PRODUCT_FIELDS].sort(),
    "update TRANSACTION_CATALOG_PRODUCT_FIELDS in lib/product-cache-refresh-scope.ts together with the catalog query",
  );
  assert.ok(
    rawSqlCalls.some((sql) => /left\(description,/.test(sql)),
    "the catalog must truncate descriptions in SQL, not after fetching them",
  );
});

test("no keyword-index field is ever classed as storefront-hidden", () => {
  const overlap = SEARCH_KEYWORD_PRODUCT_FIELDS.filter((field) => STOREFRONT_HIDDEN_PRODUCT_FIELDS.has(field));
  assert.deepEqual(overlap, []);
});

const STOREFRONT_CACHE_MARKERS = [
  "storefront:products",
  "storefront:categories",
  "storefront-product-filters",
  "storefront-category:",
  "storefront-product:",
];

/** Storefront routes that render cached storefront data (revalidated by path). */
const STOREFRONT_ROUTE_ROOTS = [
  "app/page.tsx",
  "app/sitemap.ts",
  "app/products",
  "app/product",
  "app/api/storefront-filters",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const listSourceFiles = (relativePath: string): string[] => {
  const absolute = path.join(repoRoot, relativePath);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return SOURCE_EXTENSIONS.some((ext) => absolute.endsWith(ext)) ? [absolute] : [];
  }
  return entries.flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "generated" || entry.name === "node_modules") return [];
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return listSourceFiles(child);
    return SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [path.join(repoRoot, child)] : [];
  });
};

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("storefront-cached loaders and storefront routes never read a storefront-hidden field", () => {
  // Files that DEFINE a cache entry under a storefront tag (invalidators such as the
  // product actions only name the tag and are not loaders).
  const taggedFiles = ["lib", "app", "components"]
    .flatMap(listSourceFiles)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /\bunstable_cache\b|\bcacheTag\(/.test(source) &&
        STOREFRONT_CACHE_MARKERS.some((marker) => source.includes(marker))
      );
    });
  const routeFiles = STOREFRONT_ROUTE_ROOTS.flatMap(listSourceFiles);
  const files = [...new Set([...taggedFiles, ...routeFiles])];
  assert.ok(files.length >= 10, `expected to scan the storefront loaders, found ${files.length}`);

  const violations: string[] = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const field of STOREFRONT_HIDDEN_PRODUCT_FIELDS) {
      // An object key (`salePrice: true`, `salePrice: row.x`) or a property read (`.salePrice`).
      const pattern = new RegExp(`(?:\\b${field}\\s*:|\\.${field}\\b)`);
      if (pattern.test(source)) violations.push(`${path.relative(repoRoot, file)} reads ${field}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    "a storefront cache now shows this field — remove it from STOREFRONT_HIDDEN_PRODUCT_FIELDS",
  );
});

/** Keys (`key:` or shorthand `key,`) at the top level of the first `{ ... }` block after `marker`. */
const topLevelKeysAfter = (source: string, marker: string): string[] => {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `marker not found: ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let close = open;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === "]") depth -= 1;
    if (depth === 0) {
      close = index;
      break;
    }
  }
  const keys: string[] = [];
  let lineDepth = 0;
  for (const line of source.slice(open + 1, close).split("\n")) {
    const match = /^\s*(\w+)\s*:/.exec(line) ?? /^\s*(\w+),\s*$/.exec(line);
    if (lineDepth === 0 && match) keys.push(match[1]);
    for (const char of line) {
      if (char === "{" || char === "(" || char === "[") lineDepth += 1;
      if (char === "}" || char === ")" || char === "]") lineDepth -= 1;
    }
  }
  return keys;
};

test("the product audit snapshot covers every column updateProduct writes", () => {
  const source = readFileSync(
    path.join(repoRoot, "app", "admin", "(protected)", "products", "actions.ts"),
    "utf8",
  );
  // The snapshot is the object getProductAuditSnapshot returns.
  const snapshotSource = source.slice(source.indexOf("async function getProductAuditSnapshot"));
  const returnedKeys = new Set(topLevelKeysAfter(snapshotSource, "return {"));
  assert.ok(returnedKeys.size > 20, "snapshot return object parsed");

  const updateSource = source.slice(source.indexOf("export const updateProduct"));
  const productUpdate = updateSource.slice(updateSource.indexOf("const updatedProduct = await tx.product.update("));
  const writtenColumns = topLevelKeysAfter(productUpdate, "data:");
  assert.ok(writtenColumns.length > 15, "updateProduct data block parsed");

  const missing = writtenColumns.filter((column) => !returnedKeys.has(column));
  assert.deepEqual(
    missing,
    [],
    "add these columns to getProductAuditSnapshot, or the cache scope cannot see their changes",
  );
  // Child collections the save rewrites are snapshotted under these keys.
  for (const key of ["priceListPrices", "units", "productImages", "aliases", "fitments", "compatibleFitments"]) {
    assert.ok(returnedKeys.has(key), `snapshot is missing ${key}`);
  }
});
