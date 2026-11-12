import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import type { TransactionProductDetailRow } from "@/lib/transaction-product-search";

/**
 * Q11 (review 2026-11-12): the on-site warranty form searched a list cut at the first 500 products
 * by name, so later products could not be picked. It now searches every product through the shared
 * transaction product search, keeping the old rule: active and not Lot Control.
 */
const detailRow = (overrides: Partial<TransactionProductDetailRow>): TransactionProductDetailRow => ({
  id: "p", code: "P", name: "สินค้า", description: null, salePrice: 100, retailPrice: 100, memberPrice: 90,
  priceListPrices: {}, pricePromotions: [], costPrice: 60, avgCost: 61, saleUnitName: "ชิ้น", purchaseUnitName: "ชิ้น",
  warrantyDays: 0, inventoryTracking: "TRACKED", isLotControl: false, lotIssueMethod: "FEFO", allowExpiredIssue: false,
  requireExpiryDate: false, preferredSupplierId: null, preferredSupplierName: null, preferredSupplierActive: false,
  categoryName: "หมวด", brandName: null, units: [{ name: "ชิ้น", scale: 1, isBase: true }], isActive: true,
  ...overrides,
});

const SEARCH_RESULTS: TransactionProductDetailRow[] = [
  // Name sorts after the first 500 products — the old form never listed it.
  detailRow({ id: "late", code: "Z-900", name: "ฮอร์นไฟฟ้า 12V", brandName: "Bosch" }),
  detailRow({ id: "lot", code: "Z-901", name: "ฮอร์นแบตเตอรี่", isLotControl: true }),
  detailRow({ id: "off", code: "Z-902", name: "ฮอร์นเลิกขาย", isActive: false }),
];

let allowed = true;
let searchFails = false;
const queries: string[] = [];

before(async () => {
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async (permission: string) => {
        assert.equal(permission, "warranties.create");
        if (!allowed) throw new Error("FORBIDDEN");
        return { user: { id: "u1" } };
      },
    },
  });
  await mock.module("@/lib/transaction-product-search", {
    namedExports: {
      searchTransactionProductDetailRows: async (query: string) => {
        queries.push(query);
        if (searchFails) throw new Error("db down");
        return SEARCH_RESULTS;
      },
    },
  });
});

beforeEach(() => {
  allowed = true;
  searchFails = false;
  queries.length = 0;
});

test("finds a product beyond the old 500-by-name cut and keeps only active, non-Lot-Control products", async () => {
  const { searchWarrantyProducts } = await import("../actions");
  assert.deepEqual(await searchWarrantyProducts("ฮอร์น"), [{
    id: "late", code: "Z-900", name: "ฮอร์นไฟฟ้า 12V", description: null, categoryName: "หมวด", brandName: "Bosch",
    isActive: true,
  }]);
  assert.deepEqual(queries, ["ฮอร์น"]);
});

test("the options carry no price or cost to the browser", async () => {
  const { toWarrantyProductOptions } = await import("../warranty-product-options");
  const [option] = toWarrantyProductOptions(SEARCH_RESULTS);
  assert.deepEqual(Object.keys(option).sort(), ["brandName", "categoryName", "code", "description", "id", "isActive", "name"]);
});

test("without warranties.create, or with an oversized query, nothing is searched", async () => {
  const { searchWarrantyProducts } = await import("../actions");
  allowed = false;
  assert.deepEqual(await searchWarrantyProducts("ฮอร์น"), []);
  allowed = true;
  assert.deepEqual(await searchWarrantyProducts("x".repeat(101)), []);
  assert.deepEqual(queries, []);
});

test("a failed search throws so the picker shows its retry message", async () => {
  const { searchWarrantyProducts } = await import("../actions");
  searchFails = true;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(searchWarrantyProducts("ฮอร์น"), /WARRANTY_PRODUCT_SEARCH_FAILED/);
  } finally {
    console.error = originalError;
  }
});
