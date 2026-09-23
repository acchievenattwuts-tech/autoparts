import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Both storefront "load more" Server Actions: they must (1) cap ids, (2) respect
// the per-IP load-more ceiling, and (3) report "nothing loaded" distinctly from
// a real empty page so the UI can offer a retry. No database is touched — the
// data helpers and the limiter are module mocks.

let allowLoadMore = true;
let categoryPageImpl: () => Promise<unknown> = async () => ({
  products: [{ id: "p21" }],
  total: 45,
  page: 2,
  pageSize: 20,
});
let relatedRowsImpl: () => Promise<unknown[]> = async () => [];
const guardCalls: string[] = [];

before(async () => {
  await mock.module("@/lib/storefront-load-more-guard", {
    namedExports: {
      STOREFRONT_ID_MAX_LENGTH: 64,
      allowStorefrontLoadMore: async (label: string) => {
        guardCalls.push(label);
        return allowLoadMore;
      },
    },
  });
  await mock.module("@/lib/storefront-category", {
    namedExports: {
      getStorefrontCategoryProductPageById: () => categoryPageImpl(),
    },
  });
  await mock.module("@/lib/storefront-product", {
    namedExports: {
      getRelatedStorefrontProductsPaginated: () => relatedRowsImpl(),
    },
  });
});

beforeEach(() => {
  allowLoadMore = true;
  guardCalls.length = 0;
  mock.method(console, "error", () => undefined);
});

const relatedRow = (id: string) => ({ id, salePrice: 100, retailPrice: 120 });

test("category load-more returns ok with the page when allowed", async () => {
  const { loadMoreCategoryProductsAction } = await import(
    "../[categorySlug]/category-products-actions"
  );
  const result = await loadMoreCategoryProductsAction({ categoryId: "cat_1", page: 2 });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.total === 45 && result.page === 2);
  assert.deepEqual(guardCalls, ["loadMoreCategoryProductsAction"]);
});

test("category load-more reports a DB failure as not-loaded, not as total 0", async () => {
  const { loadMoreCategoryProductsAction } = await import(
    "../[categorySlug]/category-products-actions"
  );
  const previous = categoryPageImpl;
  categoryPageImpl = async () => {
    throw new Error("pooler dropped");
  };
  try {
    const result = await loadMoreCategoryProductsAction({ categoryId: "cat_1", page: 2 });
    assert.deepEqual(result, { ok: false });
  } finally {
    categoryPageImpl = previous;
  }
});

test("category load-more is refused when throttled, before any query", async () => {
  const { loadMoreCategoryProductsAction } = await import(
    "../[categorySlug]/category-products-actions"
  );
  allowLoadMore = false;
  let queried = false;
  const previous = categoryPageImpl;
  categoryPageImpl = async () => {
    queried = true;
    return previous();
  };
  try {
    const result = await loadMoreCategoryProductsAction({ categoryId: "cat_1", page: 2 });
    assert.deepEqual(result, { ok: false });
    assert.equal(queried, false);
  } finally {
    categoryPageImpl = previous;
  }
});

test("category load-more rejects an oversized category id without touching the limiter", async () => {
  const { loadMoreCategoryProductsAction } = await import(
    "../[categorySlug]/category-products-actions"
  );
  const result = await loadMoreCategoryProductsAction({ categoryId: "x".repeat(65), page: 2 });
  assert.deepEqual(result, { ok: false });
  assert.deepEqual(guardCalls, []);
});

test("related load-more returns the page and hasMore when allowed", async () => {
  const { loadMoreRelatedProducts } = await import(
    "../../product/[productSlug]/related-products-actions"
  );
  relatedRowsImpl = async () => Array.from({ length: 9 }, (_, index) => relatedRow(`r${index}`));
  const result = await loadMoreRelatedProducts({
    categoryId: "cat_1",
    currentProductId: "prod_1",
    skip: 8,
  });
  assert.equal(result.failed, undefined);
  assert.equal(result.hasMore, true);
  assert.equal(result.products.length, 8);
  assert.equal(result.products[0].salePrice, "100");
});

test("related load-more keeps the button (hasMore) and flags failure on a DB error instead of throwing", async () => {
  const { loadMoreRelatedProducts } = await import(
    "../../product/[productSlug]/related-products-actions"
  );
  relatedRowsImpl = async () => {
    throw new Error("pooler dropped");
  };
  const result = await loadMoreRelatedProducts({
    categoryId: "cat_1",
    currentProductId: "prod_1",
    skip: 8,
  });
  assert.deepEqual(result, { products: [], hasMore: true, failed: true });
});

test("related load-more is refused when throttled", async () => {
  const { loadMoreRelatedProducts } = await import(
    "../../product/[productSlug]/related-products-actions"
  );
  allowLoadMore = false;
  const result = await loadMoreRelatedProducts({
    categoryId: "cat_1",
    currentProductId: "prod_1",
    skip: 8,
  });
  assert.equal(result.failed, true);
  assert.equal(result.hasMore, true);
});

test("related load-more rejects oversized ids", async () => {
  const { loadMoreRelatedProducts } = await import(
    "../../product/[productSlug]/related-products-actions"
  );
  const result = await loadMoreRelatedProducts({
    categoryId: "cat_1",
    currentProductId: "p".repeat(65),
    skip: 8,
  });
  assert.deepEqual(result, { products: [], hasMore: false });
  assert.deepEqual(guardCalls, []);
});
