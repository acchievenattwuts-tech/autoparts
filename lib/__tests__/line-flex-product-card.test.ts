import test from "node:test";
import assert from "node:assert/strict";

import { buildProductFlexMessage } from "@/lib/line-flex-product-card";
import type { LineMatchedProductSummary } from "@/lib/line-product-search-bridge";

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
