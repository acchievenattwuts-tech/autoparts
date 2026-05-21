import assert from "node:assert/strict";

import {
  buildProductSearchLogInput,
  shouldLogProductSearchTelemetry,
} from "../lib/product-search-telemetry";

const baseInput = {
  query: "  " + "คอมแอร์".repeat(80) + "  ",
  categoryName: "อะไหล่แอร์",
  carBrandName: "Toyota",
  carModelNames: ["Vios", "Yaris"],
  fitmentYear: 2012,
  skip: 30,
  take: 24,
};

const logInput = buildProductSearchLogInput({
  input: baseInput,
  resultCount: 0,
  source: "storefront",
  path: "/products/search",
});

assert.equal(logInput.query.length, 200);
assert.equal(logInput.resultCount, 0);
assert.equal(logInput.source, "storefront");
assert.equal(logInput.path, "/products/search");
assert.deepEqual(logInput.filters, {
  categoryName: "อะไหล่แอร์",
  carBrandName: "Toyota",
  carModelNames: ["Vios", "Yaris"],
  fitmentYear: 2012,
  skip: 30,
  take: 24,
});

assert.equal(
  shouldLogProductSearchTelemetry({ input: baseInput, resultCount: 0 }),
  true,
);
assert.equal(
  shouldLogProductSearchTelemetry({ input: baseInput, resultCount: 1 }),
  false,
);
assert.equal(
  shouldLogProductSearchTelemetry({ input: { query: "   " }, resultCount: 0 }),
  false,
);

console.log("product search telemetry tests passed");
