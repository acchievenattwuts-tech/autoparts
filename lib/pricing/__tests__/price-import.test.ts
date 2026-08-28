import assert from "node:assert/strict";
import test from "node:test";
import { parsePriceImportCsv } from "../price-import";

test("price import accepts English and Thai headers, zero, BOM, and quoted product codes", () => {
  const english = parsePriceImportCsv('\uFEFFproductCode,price\r\n"ABC-1",0\r\nXYZ,125.50');
  assert.deepEqual(english, {
    rows: [
      { line: 2, productCode: "ABC-1", amount: 0 },
      { line: 3, productCode: "XYZ", amount: 125.5 },
    ],
    errors: [],
  });
  assert.equal(parsePriceImportCsv("รหัสสินค้า,ราคา\nABC,10").rows[0]?.amount, 10);
});

test("price import rejects missing headers, invalid prices, and duplicate product codes", () => {
  assert.equal(parsePriceImportCsv("sku,value\nABC,10").errors.length, 1);
  const result = parsePriceImportCsv("code,amount\nABC,-1\nabc,20\nABC,30\nDEF,nope");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.errors, [
    "บรรทัด 2: ราคาไม่ถูกต้อง",
    "บรรทัด 4: รหัส ABC ซ้ำกับบรรทัด 3",
    "บรรทัด 5: ราคาไม่ถูกต้อง",
  ]);
});
