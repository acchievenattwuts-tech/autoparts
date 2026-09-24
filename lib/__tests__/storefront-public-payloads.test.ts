import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// End-to-end payload check for the storefront grids: runs the real category,
// search and related-products server code against a mocked DB whose row still
// carries salePrice and the exact stock count — the shape an entry cached by an
// earlier deploy has. What comes back is what gets serialized to the browser,
// so it must be the public card payload only.

const PUBLIC_CARD_KEYS = [
  "brand",
  "carModels",
  "category",
  "code",
  "id",
  "imageUrl",
  "inStock",
  "name",
  "retailPrice",
  "saleUnitName",
  "slug",
  "warrantyDays",
];

let rowStock = 3;
const searchInputs: Array<Record<string, unknown>> = [];
const cacheRegistrations = new Map<string, { revalidate?: number | false; tags?: string[] }>();
const cacheCalls: string[] = [];

const legacyCachedRow = () => ({
  id: "p1",
  slug: "compressor-p1",
  name: "คอมแอร์ VIOS",
  code: "C-001",
  imageUrl: "/products/c-001.jpg",
  salePrice: "850.00",
  retailPrice: "1200.00",
  saleUnitName: "ลูก",
  warrantyDays: 90,
  stock: rowStock,
  category: { id: "cat1", name: "คอมแอร์", slug: "compressor" },
  brand: { name: "DENSO" },
  carModels: [
    { yearStart: 2013, yearEnd: 2017, carModel: { name: "VIOS", carBrand: { name: "TOYOTA" } } },
  ],
});

before(async () => {
  await mock.module("next/cache", {
    namedExports: {
      // Pass-through: every call is a "cache hit" returning the stored row as-is.
      // Records each cache's key + options and which cache served each call.
      unstable_cache: <A extends unknown[], R>(
        fn: (...args: A) => Promise<R>,
        keyParts: string[] = [],
        options: { revalidate?: number | false; tags?: string[] } = {},
      ) => {
        const key = keyParts.join(",");
        cacheRegistrations.set(key, options);
        return (...args: A): Promise<R> => {
          cacheCalls.push(key);
          return fn(...args);
        };
      },
      revalidateTag: () => undefined,
      revalidatePath: () => undefined,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: {
          findMany: async () => [legacyCachedRow()],
          count: async () => 1,
        },
      },
      withDbRetry: <T>(fn: () => Promise<T>) => fn(),
    },
  });
  await mock.module("@/lib/storefront-load-more-guard", {
    namedExports: { STOREFRONT_ID_MAX_LENGTH: 64, allowStorefrontLoadMore: async () => true },
  });
  await mock.module("@/lib/storefront-search-intent", {
    namedExports: { resolveStorefrontSearchIntent: async () => null },
  });
  await mock.module("@/lib/product-search", {
    namedExports: {
      searchProductIds: async (input: Record<string, unknown>) => {
        searchInputs.push(input);
        return { ids: ["p1"], total: 1, mode: "v2", matchReasons: {} };
      },
      sortProductsByIds: <T>(rows: T[]) => rows,
      suggestDidYouMean: async () => [],
    },
  });
});

const assertPublicCard = (item: object, expectedInStock: boolean) => {
  assert.deepEqual(Object.keys(item).sort(), PUBLIC_CARD_KEYS);
  const card = item as { retailPrice: string; inStock: boolean; name: string };
  assert.equal(card.retailPrice, "1200.00");
  assert.equal(card.inStock, expectedInStock);
  assert.equal(card.name, "คอมแอร์ VIOS");
};

test("category grid payload (page + load-more) carries no salePrice / exact stock", async () => {
  const { getStorefrontCategoryProductPageById } = await import("@/lib/storefront-category");
  rowStock = 3;
  const page = await getStorefrontCategoryProductPageById("cat1", 1);
  assert.equal(page.total, 1);
  assertPublicCard(page.products[0], true);
});

test("search page data (page render + search Server Action) carries no salePrice / exact stock", async () => {
  const { getStorefrontProductSearchPageData } = await import("@/lib/storefront-product-search");
  rowStock = 0;
  const result = await getStorefrontProductSearchPageData({ q: "compressor", page: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.pageStart, 1);
  assert.equal(result.pageEnd, 1);
  assertPublicCard(result.products[0], false);
});

test("related-products load-more payload carries no salePrice / exact stock", async () => {
  const { loadMoreRelatedProducts } = await import(
    "../../app/product/[productSlug]/related-products-actions"
  );
  rowStock = 12;
  const result = await loadMoreRelatedProducts({
    categoryId: "cat1",
    currentProductId: "p0",
    skip: 8,
  });
  assert.equal(result.hasMore, false);
  assertPublicCard(result.products[0], true);
});

test("price range is ignored while storefront prices are hidden (it filters on salePrice)", async () => {
  const { HIDE_STOREFRONT_PRICE, resolveStorefrontPriceFilter } = await import(
    "@/lib/storefront-pricing"
  );
  assert.equal(HIDE_STOREFRONT_PRICE, true);
  assert.deepEqual(resolveStorefrontPriceFilter(100, 5000), { priceMin: null, priceMax: null });

  const { getStorefrontProductSearchPageData } = await import("@/lib/storefront-product-search");
  searchInputs.length = 0;
  await getStorefrontProductSearchPageData({ q: "compressor", page: 1, priceMin: 100, priceMax: 5000 });
  assert.ok(searchInputs.length > 0);
  for (const input of searchInputs) {
    assert.equal(input.priceMin, null);
    assert.equal(input.priceMax, null);
  }
});

test("category grid cache expires within 5 minutes (stock badges / stock order)", async () => {
  await import("@/lib/storefront-category");
  const options = cacheRegistrations.get("storefront-category-products");
  assert.ok(options, "category products cache registered");
  assert.equal(options.revalidate, 300);
  assert.deepEqual(options.tags, ["storefront:categories", "storefront:products"]);
});

test("new arrivals: page 1 keeps its daily cache, pages 2+ refresh within 5 minutes", async () => {
  const { getHomeNewArrivals } = await import("@/lib/storefront-home");
  assert.equal(cacheRegistrations.get("home2-new-arrivals-v2")?.revalidate, 86_400);
  assert.equal(cacheRegistrations.get("home2-new-arrivals-later-v1")?.revalidate, 300);

  cacheCalls.length = 0;
  const first = await getHomeNewArrivals(1);
  const second = await getHomeNewArrivals(2);
  assert.deepEqual(cacheCalls, ["home2-new-arrivals-v2", "home2-new-arrivals-later-v1"]);
  assert.equal(first.page, 1);
  assert.equal(second.page, 2);
  // Home cards never carried a use for the exact stock count.
  assert.equal("stock" in second.products[0], false);
  assert.equal("salePrice" in second.products[0], false);
});
