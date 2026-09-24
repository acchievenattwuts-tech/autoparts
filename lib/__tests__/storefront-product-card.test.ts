import assert from "node:assert/strict";
import test from "node:test";
import { toStorefrontProductCardItem } from "@/lib/storefront-product-card";

// The storefront card payload may carry only what ProductCard renders: the
// retail price and an in/out-of-stock flag. Wholesale price (salePrice) and the
// exact stock count stay on the server.

const PUBLIC_CARD_KEYS = [
  "brand",
  "carModels",
  "category",
  "code",
  "id",
  "imageUrl",
  "inStock",
  "name",
  "retailPrice",
  "saleUnitName",
  "slug",
  "warrantyDays",
];

const serverRow = (
  overrides: Partial<{ stock: number; retailPrice: { toString(): string } }> = {},
) => ({
  id: "p1",
  slug: "compressor-p1",
  name: "คอมแอร์ VIOS",
  code: "C-001",
  imageUrl: "/products/c-001.jpg",
  retailPrice: { toString: () => "1200.00" },
  saleUnitName: "ลูก",
  warrantyDays: 90,
  stock: 3,
  category: { id: "cat1", name: "คอมแอร์", slug: "compressor" },
  brand: { name: "DENSO" },
  carModels: [
    { yearStart: 2013, yearEnd: 2017, carModel: { name: "VIOS", carBrand: { name: "TOYOTA" } } },
  ],
  ...overrides,
});

test("card payload keeps every rendered field and drops salePrice / exact stock", () => {
  const item = toStorefrontProductCardItem(serverRow());
  assert.deepEqual(Object.keys(item).sort(), PUBLIC_CARD_KEYS);
  assert.deepEqual(item, {
    id: "p1",
    slug: "compressor-p1",
    name: "คอมแอร์ VIOS",
    code: "C-001",
    imageUrl: "/products/c-001.jpg",
    retailPrice: "1200.00",
    saleUnitName: "ลูก",
    warrantyDays: 90,
    inStock: true,
    category: { id: "cat1", name: "คอมแอร์", slug: "compressor" },
    brand: { name: "DENSO" },
    carModels: [
      { yearStart: 2013, yearEnd: 2017, carModel: { name: "VIOS", carBrand: { name: "TOYOTA" } } },
    ],
  });
});

test("inStock matches the badge rule ProductCard used before (stock > 0)", () => {
  assert.equal(toStorefrontProductCardItem(serverRow({ stock: 1 })).inStock, true);
  assert.equal(toStorefrontProductCardItem(serverRow({ stock: 250 })).inStock, true);
  assert.equal(toStorefrontProductCardItem(serverRow({ stock: 0 })).inStock, false);
  assert.equal(toStorefrontProductCardItem(serverRow({ stock: -2 })).inStock, false);
});

test("a stale cached row that still carries salePrice is stripped (explicit pick, no spread)", () => {
  const staleCachedRow = { ...serverRow(), salePrice: "850.00", retailPrice: "1200.00" };
  const item = toStorefrontProductCardItem(staleCachedRow);
  assert.equal("salePrice" in item, false);
  assert.equal("stock" in item, false);
  assert.equal(item.retailPrice, "1200.00");
});

test("retailPrice serializes the same from a Decimal, a cached string, or a number", () => {
  assert.equal(toStorefrontProductCardItem(serverRow({ retailPrice: { toString: () => "0" } })).retailPrice, "0");
  assert.equal(toStorefrontProductCardItem({ ...serverRow(), retailPrice: "450.50" }).retailPrice, "450.50");
  assert.equal(toStorefrontProductCardItem({ ...serverRow(), retailPrice: 99 }).retailPrice, "99");
});
