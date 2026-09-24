import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// `mode=admin` widens autocomplete to storefront-hidden products and returns
// wholesale price, exact stock and the admin link. It must only take effect for
// a signed-in session holding products.view; every other caller silently gets
// the storefront result. Any request that asked for admin mode stays out of
// shared caches.

type Session = { role: string; permissions: string[] } | null;

let session: Session = null;
let authCalls = 0;
let userAgentIsBot = false;
const searchInputs: Array<Record<string, unknown>> = [];
const findManyWheres: Array<Record<string, unknown>> = [];

const hiddenProductRow = {
  id: "p-hidden",
  slug: "hidden-part",
  code: "H-001",
  name: "Hidden part",
  imageUrl: null,
  salePrice: "850.00",
  saleUnitName: "ชิ้น",
  reportUnitName: "ชิ้น",
  stock: 4,
  category: { name: "คอมแอร์", slug: "compressor" },
  brand: { name: "DENSO" },
};

before(async () => {
  await mock.module("@/lib/require-auth", {
    namedExports: {
      getSessionPermissionContext: async () => {
        authCalls += 1;
        if (!session) throw new Error("UNAUTHORIZED");
        return { session: {}, role: session.role, permissions: session.permissions };
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: {
          findMany: async (args: { where: Record<string, unknown> }) => {
            findManyWheres.push(args.where);
            return [hiddenProductRow];
          },
        },
      },
    },
  });
  await mock.module("@/lib/search-bot", {
    namedExports: { isLikelyBotUserAgent: () => userAgentIsBot },
  });
  await mock.module("@/lib/storefront-product-search", {
    namedExports: {
      runStorefrontProductSearchWithRequiredTokenFallback: async (input: Record<string, unknown>) => {
        searchInputs.push(input);
        return { searchResult: { ids: ["p-hidden"], total: 1 } };
      },
    },
  });
  await mock.module("@/lib/product-search-telemetry", {
    namedExports: { logProductSearchTelemetry: async () => undefined },
  });
});

beforeEach(() => {
  session = null;
  authCalls = 0;
  userAgentIsBot = false;
  searchInputs.length = 0;
  findManyWheres.length = 0;
});

let ipCounter = 0;
const request = (mode?: string) => {
  ipCounter += 1;
  const params = new URLSearchParams({ q: "hidden" });
  if (mode) params.set("mode", mode);
  return new Request(`https://example.test/api/search/products/autocomplete?${params}`, {
    headers: { "user-agent": "Mozilla/5.0", "x-forwarded-for": `198.51.100.${ipCounter}` },
  });
};

type Item = Record<string, unknown>;
const readItems = async (response: Response): Promise<Item[]> =>
  ((await response.json()) as { items: Item[] }).items;

const assertStorefrontItem = (item: Item) => {
  assert.equal(item.inStock, true);
  assert.equal(item.href, "/product/hidden-part-p-hidden");
  assert.equal("salePrice" in item, false);
  assert.equal("stock" in item, false);
  assert.equal("adminHref" in item, false);
};

test("anonymous mode=admin is served as storefront: visible-only filter, no admin fields, never shared-cached", async () => {
  const { GET } = await import("../route");
  const response = await GET(request("admin"));
  assert.equal(response.status, 200);
  assert.equal(searchInputs[0].isStorefrontVisible, true);
  assert.equal(searchInputs[0].cacheProfile, "storefront");
  assertStorefrontItem((await readItems(response))[0]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("signed-in without products.view is served as storefront too", async () => {
  const { GET } = await import("../route");
  session = { role: "STAFF", permissions: ["sales.view"] };
  const response = await GET(request("admin"));
  assert.equal(searchInputs[0].isStorefrontVisible, true);
  assert.equal(searchInputs[0].cacheProfile, "storefront");
  assertStorefrontItem((await readItems(response))[0]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("products.view session gets the full admin result, exactly as before, privately", async () => {
  const { GET } = await import("../route");
  session = { role: "STAFF", permissions: ["products.view"] };
  const response = await GET(request("admin"));
  assert.equal("isStorefrontVisible" in searchInputs[0], false);
  assert.equal(searchInputs[0].cacheProfile, "admin");
  const body = (await response.json()) as { items: Item[]; totalCount: number };
  assert.equal(body.totalCount, 1);
  assert.deepEqual(body.items[0], {
    id: "p-hidden",
    code: "H-001",
    name: "Hidden part",
    imageUrl: null,
    inStock: true,
    saleUnitName: "ชิ้น",
    reportUnitName: "ชิ้น",
    brand: "DENSO",
    category: "คอมแอร์",
    href: "/product/hidden-part-p-hidden",
    salePrice: 850,
    stock: 4,
    adminHref: "/admin/products/p-hidden/preview",
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("storefront mode never touches the session and keeps its shared-cache header", async () => {
  const { GET } = await import("../route");
  session = { role: "ADMIN", permissions: ["products.view"] };
  const response = await GET(request());
  assert.equal(authCalls, 0);
  assert.equal(searchInputs[0].isStorefrontVisible, true);
  assertStorefrontItem((await readItems(response))[0]);
  assert.equal(response.headers.get("cache-control"), "public, max-age=30, s-maxage=60");
});

test("bot path honours the same gate", async () => {
  const { GET } = await import("../route");
  userAgentIsBot = true;
  const anonymous = await GET(request("admin"));
  assert.equal(findManyWheres[0].isStorefrontVisible, true);
  assertStorefrontItem((await readItems(anonymous))[0]);
  assert.equal(anonymous.headers.get("cache-control"), "private, no-store");

  session = { role: "STAFF", permissions: ["products.view"] };
  const admin = await GET(request("admin"));
  assert.equal("isStorefrontVisible" in findManyWheres[1], false);
  assert.equal((await readItems(admin))[0].adminHref, "/admin/products/p-hidden/preview");
});
