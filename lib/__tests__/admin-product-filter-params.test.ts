import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdminProductFilterSearchParams,
  parseAdminProductFilterParams,
} from "@/lib/admin-product-filter-params";

test("parseAdminProductFilterParams keeps year range params and drops legacy price params", () => {
  const result = parseAdminProductFilterParams({
    search: "คอยล์เย็น",
    categoryId: "cat-1",
    brandId: "brand-1",
    carBrandId: "car-brand-1",
    carModelId: "car-model-1",
    yearMin: "2012",
    yearMax: "2018",
    priceMin: "100",
    priceMax: "200",
    stockStatus: "in_stock",
    statusFilter: "active",
    trackingFilter: "tracked",
  });

  assert.deepEqual(result, {
    search: "คอยล์เย็น",
    categoryId: "cat-1",
    brandId: "brand-1",
    carBrandId: "car-brand-1",
    carModelId: "car-model-1",
    yearMin: "2012",
    yearMax: "2018",
    stockStatus: "in_stock",
    statusFilter: "active",
    trackingFilter: "tracked",
  });
});

test("buildAdminProductFilterSearchParams serializes year range params and omits empty values", () => {
  const result = buildAdminProductFilterSearchParams({
    search: "denso",
    yearMin: "2010",
    yearMax: "2015",
    stockStatus: "",
    statusFilter: undefined,
    trackingFilter: "tracked",
  });

  assert.deepEqual(result, {
    search: "denso",
    yearMin: "2010",
    yearMax: "2015",
    trackingFilter: "tracked",
  });
  assert.equal("priceMin" in result, false);
  assert.equal("priceMax" in result, false);
});

test("parseProductReportFilters reads year range params for export filters", async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";
  const { parseProductReportFilters } = await import("@/lib/product-report-queries");

  const result = parseProductReportFilters({
    search: "แผงแอร์",
    yearMin: "2008",
    yearMax: "2013",
    priceMin: "500",
    priceMax: "1000",
  });

  assert.deepEqual(result, {
    search: "แผงแอร์",
    yearMin: "2008",
    yearMax: "2013",
  });
});
