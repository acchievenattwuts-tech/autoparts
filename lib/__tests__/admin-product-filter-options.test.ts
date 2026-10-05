import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before, mock } from "node:test";

// Egress review 2026-10-05 (E2): the admin product list and product search pages
// re-render on every filter change; their category / brand / car-model options must
// come from the cached master lists, not three fresh queries per render.

const queriedModels: string[] = [];
const categoryFindManyArgs: unknown[] = [];

const recordFindMany =
  <T>(model: string, rows: T[]) =>
  async (): Promise<T[]> => {
    queriedModels.push(model);
    return rows;
  };

before(async () => {
  await mock.module("next/cache", {
    namedExports: {
      unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => fn,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        category: {
          findMany: async (args: unknown) => {
            categoryFindManyArgs.push(args);
            return recordFindMany("category", [
              { id: "c1", name: "คอมแอร์", slug: "compressor", isActive: true, sortOrder: 1, createdAt: new Date() },
            ])();
          },
        },
        partsBrand: {
          findMany: recordFindMany("partsBrand", [{ id: "b1", name: "DENSO", isActive: true, createdAt: new Date() }]),
        },
        carBrand: {
          findMany: recordFindMany("carBrand", [
            {
              id: "cb1",
              name: "Toyota",
              isActive: true,
              carModels: [{ id: "m1", name: "Vios", carBrandId: "cb1", isActive: true, createdAt: new Date() }],
            },
          ]),
        },
      },
      withDbRetry: <R>(fn: () => Promise<R>): Promise<R> => fn(),
    },
  });
});

test("filter options are trimmed to id/name from the cached master lists", async () => {
  const { getAdminProductFilterOptions } = await import("@/lib/admin-master-options");
  const options = await getAdminProductFilterOptions();

  assert.deepEqual(options, {
    categories: [{ id: "c1", name: "คอมแอร์" }],
    partsBrands: [{ id: "b1", name: "DENSO" }],
    carBrands: [{ id: "cb1", name: "Toyota", carModels: [{ id: "m1", name: "Vios" }] }],
  });
  assert.deepEqual([...queriedModels].sort(), ["carBrand", "category", "partsBrand"]);
});

const PRODUCT_FILTER_PAGES = [
  path.join("app", "admin", "(protected)", "products", "page.tsx"),
  path.join("app", "admin", "(protected)", "products", "search", "page.tsx"),
];

for (const relativePath of PRODUCT_FILTER_PAGES) {
  test(`${relativePath} loads filter options through the cached helper`, () => {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, /getAdminProductFilterOptions\(\)/);
    assert.doesNotMatch(source, /db\.(category|partsBrand|carBrand|carModel)\.findMany\(/);
  });
}

// Report filters use the same cached master lists (out-of-scope fix, 2026-10-05).
const REPORT_FILTER_PAGES: Array<[string, RegExp]> = [
  [path.join("app", "admin", "(protected)", "reports", "product-search-no-result", "page.tsx"), /getActiveCarBrandFilterOptions\(\)/],
  [path.join("app", "admin", "(protected)", "reports", "sales-line-profit", "page.tsx"), /getActiveCategoryFilterOptions\(\)/],
  [path.join("app", "admin", "(protected)", "reports", "stock", "page.tsx"), /getAllCategoryFilterOptions\(\)/],
];

for (const [relativePath, helperCall] of REPORT_FILTER_PAGES) {
  test(`${relativePath} reads master filter options from the cache`, () => {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    assert.match(source, helperCall);
    assert.doesNotMatch(source, /db\.(category|partsBrand|carBrand|carModel)\.findMany\(/);
  });
}

test("the stock report keeps inactive categories in its filter", async () => {
  const { getAllCategoryFilterOptions } = await import("@/lib/admin-master-options");
  categoryFindManyArgs.length = 0;
  await getAllCategoryFilterOptions();
  // No isActive filter: products in a retired category can still hold stock.
  assert.deepEqual(categoryFindManyArgs, [{ orderBy: { name: "asc" }, select: { id: true, name: true } }]);
});
