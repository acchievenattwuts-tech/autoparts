import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before, beforeEach, mock } from "node:test";

// Review item #58: the page no longer ships every product; the form searches via
// searchAdjustmentProducts, gated by stock.adjustments.create.

let allowed = true;
const permissionChecks: string[] = [];
const searches: string[] = [];

before(async () => {
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async (permission: string) => {
        permissionChecks.push(permission);
        if (!allowed) throw new Error("FORBIDDEN");
        return { user: { id: "u1" } };
      },
    },
  });
  await mock.module("@/lib/adjustment-product-search", {
    namedExports: {
      searchAdjustmentProductOptions: async (query: string) => {
        searches.push(query);
        return [{ id: "p1" }];
      },
    },
  });
});

beforeEach(() => {
  allowed = true;
  permissionChecks.length = 0;
  searches.length = 0;
});

test("searchAdjustmentProducts requires stock.adjustments.create", async () => {
  const { searchAdjustmentProducts } = await import("../actions");
  assert.deepEqual(await searchAdjustmentProducts("คอมแอร์"), [{ id: "p1" }]);
  assert.deepEqual(permissionChecks, ["stock.adjustments.create"]);

  allowed = false;
  searches.length = 0;
  assert.deepEqual(await searchAdjustmentProducts("คอมแอร์"), []);
  assert.equal(searches.length, 0);
});

test("searchAdjustmentProducts rejects oversized queries without searching", async () => {
  const { searchAdjustmentProducts } = await import("../actions");
  assert.deepEqual(await searchAdjustmentProducts("x".repeat(101)), []);
  assert.equal(searches.length, 0);
});

const read = (file: string): string =>
  readFileSync(path.join(process.cwd(), "app/admin/(protected)/stock/adjustments", file), "utf8");

test("the page passes no product catalog and the form searches on demand", () => {
  const page = read("page.tsx");
  assert.doesNotMatch(page, /db\.product\.findMany/);
  assert.match(page, /<AdjustmentForm products=\{\[\]\}/);

  const form = read("AdjustmentForm.tsx");
  assert.match(form, /searchProducts=\{searchAdjustmentProducts\}/);
  // A picked product is kept in state and used directly for defaults/lot setup.
  assert.match(form, /rememberProduct\(picked\);\s*updateItem\(i, "productId", picked\.id, picked\);/);
  assert.match(form, /const product = pickedProduct \?\? products\.find/);
});
