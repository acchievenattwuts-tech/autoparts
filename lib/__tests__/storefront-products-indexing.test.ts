import test from "node:test";
import assert from "node:assert/strict";

import { shouldNoIndexProductsListing } from "@/lib/storefront-products-indexing";

test("keeps only the unfiltered first products page indexable", () => {
  assert.equal(shouldNoIndexProductsListing({}), false);
  assert.equal(shouldNoIndexProductsListing({ page: "1" }), false);
});

test("noindexes every supported products filter and later result pages", () => {
  const filteredCases = [
    { q: "คอมแอร์" },
    { category: "compressor" },
    { brand: "Denso" },
    { model: "Civic" },
    { year: "2020" },
    { page: "2" },
    { categories: ["compressor"] },
    { partsBrand: "Denso" },
    { carBrand: "Honda" },
    { yearMin: "2018" },
    { yearMax: "2022" },
    { priceMin: "500" },
    { priceMax: "5000" },
  ];

  for (const params of filteredCases) {
    assert.equal(shouldNoIndexProductsListing(params), true, JSON.stringify(params));
  }
});
