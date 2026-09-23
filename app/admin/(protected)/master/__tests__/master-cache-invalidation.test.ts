import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// Cache-invalidation scope for master-data writes:
//  - CategoryAlias writes refresh only what reads aliases (product-search tag and,
//    for MATCH aliases, the SearchKeyword index) — no storefront page/tag purge and
//    no per-product id query.
//  - CarBrandAlias writes skip the SearchKeyword rebuild (the index never reads them).
//  - PartsBrand writes rely on "storefront:products" instead of re-tagging each product.

type Calls = {
  updateTag: string[];
  revalidatePath: string[];
  productSearch: number;
  keywordRefresh: number;
  productIdQueries: number;
};

const calls: Calls = { updateTag: [], revalidatePath: [], productSearch: 0, keywordRefresh: 0, productIdQueries: 0 };
const resetCalls = (): void => {
  calls.updateTag.length = 0;
  calls.revalidatePath.length = 0;
  calls.productSearch = 0;
  calls.keywordRefresh = 0;
  calls.productIdQueries = 0;
};

type AliasRow = { id: string; categoryId: string; alias: string; kind: "MATCH" | "SKIP_CATEGORY"; isActive: boolean };
const categoryAliases = new Map<string, AliasRow>([
  ["aliasmatch", { id: "aliasmatch", categoryId: "cat1", alias: "ผ้าเบรค", kind: "MATCH", isActive: true }],
  ["aliasskip", { id: "aliasskip", categoryId: "cat1", alias: "ยาง", kind: "SKIP_CATEGORY", isActive: true }],
]);

const fakeDb = {
  product: {
    findMany: async (): Promise<Array<{ id: string }>> => {
      calls.productIdQueries += 1;
      return [{ id: "p1" }, { id: "p2" }];
    },
  },
  category: {
    findUnique: async () => ({ id: "cat1", name: "เบรค", slug: "brake" }),
  },
  categoryAlias: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = categoryAliases.get(where.id);
      return row ? { ...row, matchMode: "CONTAINS", priority: 0, notes: null, source: "MANUAL", reviewStatus: null, aiCorrectedTerm: null } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<AliasRow> }) => {
      const row = categoryAliases.get(where.id);
      assert.ok(row);
      Object.assign(row, data);
      return row;
    },
    create: async ({ data }: { data: Omit<AliasRow, "id" | "isActive"> }) => {
      const row: AliasRow = { id: `alias${categoryAliases.size + 1}`, isActive: true, ...data };
      categoryAliases.set(row.id, row);
      return row;
    },
  },
  carBrand: {
    findUnique: async () => ({ id: "brand1", name: "Toyota", isActive: true }),
    update: async () => ({}),
  },
  carBrandAlias: {
    findUnique: async () => ({ id: "carAlias1", carBrandId: "brand1", alias: "โตโยต้า", isActive: true, notes: null }),
    create: async () => ({ id: "carAlias1" }),
    update: async () => ({}),
  },
  partsBrand: {
    findUnique: async () => ({ id: "pb1", name: "Denso", isActive: true }),
    update: async () => ({}),
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", {
    namedExports: {
      updateTag: (tag: string) => calls.updateTag.push(tag),
      revalidatePath: (path: string) => calls.revalidatePath.push(path),
      revalidateTag: () => undefined,
      unstable_cache: <T>(fn: T): T => fn,
    },
  });
  await mock.module("@/lib/db", { namedExports: { db: fakeDb, withDbRetry: async <T>(fn: () => Promise<T>) => fn() } });
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async () => ({ user: { id: "u1" } }),
      requireAnyPermission: async () => ({ user: { id: "u1" } }),
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: unknown, afterValue: unknown) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "u1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/product-search-cache", {
    namedExports: { updateProductSearchCache: () => (calls.productSearch += 1) },
  });
  await mock.module("@/lib/search-keyword-index", {
    namedExports: { triggerSearchKeywordRefresh: () => (calls.keywordRefresh += 1) },
  });
  await mock.module("@/lib/products-bucket-storage", {
    namedExports: {
      deleteCategoryImageObjects: async () => undefined,
      isOwnedBlobCategoryImageUrl: () => true,
      uploadProductsBucketObject: async () => "",
    },
  });
  await mock.module("@/lib/storefront-revalidation", {
    namedExports: { refreshCategoryStorefrontCaches: async () => undefined },
  });
  await mock.module("@/lib/category-alias-cache", { namedExports: { invalidateCategoryAliasCache: () => undefined } });
  await mock.module("@/lib/car-brand-alias-cache", { namedExports: { invalidateCarBrandAliasCache: () => undefined } });
  await mock.module("@/lib/transaction-options", { namedExports: { invalidateTransactionProductOptions: () => undefined } });
});

const storefrontTags = (): string[] => calls.updateTag.filter((tag) => tag.startsWith("storefront"));
const storefrontPaths = (): string[] => calls.revalidatePath.filter((path) => !path.startsWith("/admin"));

const aliasForm = (kind: "MATCH" | "SKIP_CATEGORY"): FormData => {
  const form = new FormData();
  form.set("alias", "คำทดสอบ");
  form.set("kind", kind);
  form.set("matchMode", "CONTAINS");
  form.set("priority", "0");
  form.set("notes", "");
  return form;
};

test("category alias writes skip storefront purges and the per-product id query", { skip: moduleMocksUnavailable }, async () => {
  const { toggleCategoryAlias, createCategoryAlias, updateCategoryAlias } = await import("../categories/actions");

  resetCalls();
  assert.deepEqual(await toggleCategoryAlias("aliasmatch", false), {});
  assert.deepEqual(storefrontTags(), []);
  assert.deepEqual(storefrontPaths(), []);
  assert.equal(calls.productIdQueries, 0);
  assert.equal(calls.productSearch, 1, "storefront search intent still sees the alias change");
  assert.equal(calls.keywordRefresh, 1, "MATCH aliases feed the SearchKeyword index");
  assert.ok(calls.updateTag.includes("admin-master:categories"));
  assert.ok(calls.revalidatePath.includes("/admin/master/categories"));

  resetCalls();
  assert.deepEqual(await toggleCategoryAlias("aliasskip", false), {});
  assert.equal(calls.productSearch, 1);
  assert.equal(calls.keywordRefresh, 0, "SKIP_CATEGORY aliases never reach the index");

  resetCalls();
  assert.deepEqual(await createCategoryAlias("cat1", aliasForm("MATCH")), {});
  assert.equal(calls.keywordRefresh, 1);
  assert.deepEqual(storefrontTags(), []);

  resetCalls();
  assert.deepEqual(await createCategoryAlias("cat1", aliasForm("SKIP_CATEGORY")), {});
  assert.equal(calls.keywordRefresh, 0);

  resetCalls();
  // SKIP → MATCH adds an index row, so the rebuild must run.
  assert.deepEqual(await updateCategoryAlias("aliasskip", aliasForm("MATCH")), {});
  assert.equal(calls.keywordRefresh, 1);
  assert.equal(calls.productIdQueries, 0);
});

test("car-brand alias writes keep search caches but skip the keyword rebuild", { skip: moduleMocksUnavailable }, async () => {
  const { toggleCarBrandAlias, createCarBrandAlias, toggleCarBrand } = await import("../car-brands/actions");

  resetCalls();
  assert.deepEqual(await toggleCarBrandAlias("caralias1", false), {});
  assert.equal(calls.keywordRefresh, 0);
  assert.equal(calls.productSearch, 1);
  assert.deepEqual(storefrontTags().sort(), ["storefront-product-filters", "storefront:products"]);

  resetCalls();
  const form = new FormData();
  form.set("alias", "โตโยต้า");
  form.set("notes", "");
  assert.deepEqual(await createCarBrandAlias("brand1", form), {});
  assert.equal(calls.keywordRefresh, 0);
  assert.equal(calls.productSearch, 1);

  resetCalls();
  assert.deepEqual(await toggleCarBrand("brand1", false), {});
  assert.equal(calls.keywordRefresh, 1, "brand names are indexed, so brand toggles still rebuild");
});

test("parts-brand writes rely on the broad storefront tag instead of per-product tags", { skip: moduleMocksUnavailable }, async () => {
  const { togglePartsBrand } = await import("../parts-brands/actions");

  resetCalls();
  assert.deepEqual(await togglePartsBrand("pb1", false), {});
  assert.equal(calls.productIdQueries, 0);
  assert.ok(calls.updateTag.includes("storefront:products"));
  assert.ok(calls.updateTag.includes("storefront-product-filters"));
  assert.equal(calls.updateTag.filter((tag) => tag.startsWith("storefront-product:")).length, 0);
  assert.deepEqual(calls.revalidatePath.sort(), ["/admin/master/parts-brands", "/products", "/sitemap.xml"]);
  assert.equal(calls.productSearch, 1);
  assert.equal(calls.keywordRefresh, 1);
});
