import test from "node:test";
import assert from "node:assert/strict";

import { buildProductFlexMessage } from "@/lib/line-flex-product-card";
import {
  applyLinePriceVisibility,
  type LineMatchedProductSummary,
} from "@/lib/chat-core/product-search-bridge";

process.env.NEXTAUTH_URL = "https://shop.example.com";
delete process.env.APP_BASE_URL;
delete process.env.LINE_FLEX_PLACEHOLDER_IMAGE_URL;

const product = (over: Partial<LineMatchedProductSummary> = {}): LineMatchedProductSummary => ({
  id: "p1",
  name: "คอยล์เย็น วีออส",
  code: "CL-001",
  imageUrl: "https://img.example.com/a.jpg",
  salePrice: 1200,
  ...over,
});

test("returns null when there are no products", () => {
  assert.equal(buildProductFlexMessage({ products: [], searchQuery: "วีออส", total: 0 }), null);
});

test("single product builds a bubble linking to the product page", () => {
  const msg = buildProductFlexMessage({ products: [product()], searchQuery: "วีออส", total: 1 });
  assert.ok(msg);
  assert.equal(msg.type, "flex");
  const contents = msg.contents as Record<string, unknown>;
  assert.equal(contents.type, "bubble");
  const json = JSON.stringify(msg);
  // Canonical URL embeds the product id at the end of the slug.
  assert.match(json, /https:\/\/shop\.example\.com\/product\/[^"]*-p1/);
  assert.match(json, /฿1,200/);
});

test("multiple products build a carousel with a view-all bubble to the search page", () => {
  const msg = buildProductFlexMessage({
    products: [product(), product({ id: "p2", name: "คอยล์ 2" })],
    searchQuery: "วีออส",
    total: 25,
  });
  assert.ok(msg);
  const contents = msg.contents as { type: string; contents: unknown[] };
  assert.equal(contents.type, "carousel");
  // 2 product bubbles + 1 view-all bubble.
  assert.equal(contents.contents.length, 3);
  assert.ok(JSON.stringify(msg).includes(`/products?q=${encodeURIComponent("วีออส")}`));
});

test("falls back to omitting the image when product has none and no placeholder is set", () => {
  const msg = buildProductFlexMessage({
    products: [product({ imageUrl: null })],
    searchQuery: null,
    total: 1,
  });
  assert.ok(msg);
  assert.equal((msg.contents as Record<string, unknown>).hero, undefined);
});

test("price shows 'สอบถามราคา' when salePrice is zero", () => {
  const msg = buildProductFlexMessage({ products: [product({ salePrice: 0 })], searchQuery: null, total: 1 });
  assert.ok(msg);
  assert.match(JSON.stringify(msg), /สอบถามราคา/);
});

test("applyLinePriceVisibility keeps real prices when showPrice is true (e.g. garage)", () => {
  const products = [product({ salePrice: 1200 }), product({ id: "p2", salePrice: 350 })];
  const visible = applyLinePriceVisibility(products, true);
  assert.deepEqual(
    visible.map((p) => p.salePrice),
    [1200, 350],
  );
});

test("applyLinePriceVisibility zeroes prices when showPrice is false (general customer)", () => {
  const products = [product({ salePrice: 1200 }), product({ id: "p2", salePrice: 350 })];
  const hidden = applyLinePriceVisibility(products, false);
  assert.deepEqual(
    hidden.map((p) => p.salePrice),
    [0, 0],
  );
  // …and a hidden product renders as "สอบถามราคา" on the flex card.
  const msg = buildProductFlexMessage({ products: hidden, searchQuery: null, total: 2 });
  assert.ok(msg);
  const json = JSON.stringify(msg);
  assert.match(json, /สอบถามราคา/);
  assert.doesNotMatch(json, /฿1,200|฿350/);
});

test("view-all URL carries the LINE search fitment filters (so web count matches)", () => {
  const msg = buildProductFlexMessage({
    products: [product(), product({ id: "p2", name: "สายน้ำยา 2" })],
    searchQuery: "น้ำยา",
    total: 27,
    filters: { categoryName: "สายน้ำยา (A/C Hose)", carModelName: "Tiida", carBrandName: null, year: null },
  });
  assert.ok(msg);
  const uri = JSON.stringify(msg).match(/https:\/\/[^"]*\/products\?[^"]*/)?.[0];
  assert.ok(uri, "view-all URL present");
  const params = new URL(uri).searchParams;
  assert.equal(params.get("q"), "น้ำยา");
  assert.equal(params.get("category"), "สายน้ำยา (A/C Hose)", "category filter carried");
  assert.equal(params.get("model"), "Tiida", "model filter carried");
  // null filters are omitted
  assert.equal(params.get("brand"), null);
  assert.equal(params.get("year"), null);
});
