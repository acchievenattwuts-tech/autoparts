import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { buildOpenClaimWarrantyWhere } from "../reports";

// Open-claims report section: with both a product-code and a customer-code range
// set, the customer filter used to be spread as a second `warranty` key and
// replaced the product filter. Both ranges must now apply together (AND).

const productRange = { gte: "P001", lte: "P099" };
const customerRange = { gte: "C001" };

test("both product and customer code ranges apply to the claim's warranty", () => {
  assert.deepEqual(buildOpenClaimWarrantyWhere(productRange, customerRange), {
    product: { code: productRange },
    sale: { customer: { code: customerRange } },
  });
});

test("a single range filters on its own and no range adds no warranty filter", () => {
  assert.deepEqual(buildOpenClaimWarrantyWhere(productRange, undefined), { product: { code: productRange } });
  assert.deepEqual(buildOpenClaimWarrantyWhere(undefined, customerRange), {
    sale: { customer: { code: customerRange } },
  });
  assert.equal(buildOpenClaimWarrantyWhere(undefined, undefined), undefined);
});

test("the open-claims query uses the merged filter instead of two warranty spreads", () => {
  const source = readFileSync(join(process.cwd(), "lib/reports.ts"), "utf8");
  const start = source.indexOf("const openClaimsPromise = db.warrantyClaim.findMany(");
  assert.ok(start > 0);
  const query = source.slice(start, source.indexOf("orderBy:", start));
  assert.match(query, /\.\.\.\(openClaimWarrantyWhere \? \{ warranty: openClaimWarrantyWhere \} : \{\}\)/);
  assert.equal(query.match(/warranty:/g)?.length, 1);
});
