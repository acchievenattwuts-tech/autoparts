import assert from "node:assert/strict";
import test from "node:test";

import {
  compressJsonForCache,
  decompressJsonFromCache,
} from "../json-cache-compression";

test("compressed cache JSON round-trips without changing fields or order", async () => {
  const value = [
    {
      id: "product-1",
      code: "P0001",
      name: "คอยล์เย็น",
      description: "รายละเอียดสินค้า รุ่นรถที่ใช้ได้ และหมายเลข OEM",
      aliasSearchText: "denso\n447500-1234\ntoyota",
      prices: { sale: 1250, retail: 1390 },
      units: [{ name: "ชิ้น", scale: 1, isBase: true }],
      isActive: true,
    },
    {
      id: "product-2",
      code: "P0002",
      name: "Expansion Valve",
      description: null,
      aliasSearchText: "วาล์วแอร์\nexp valve",
      prices: { sale: 0, retail: 0 },
      units: [],
      isActive: false,
    },
  ];

  const payload = await compressJsonForCache(value);
  const restored = await decompressJsonFromCache<typeof value>(payload);

  assert.deepEqual(restored, value);
});

test("compression provides safe headroom for repetitive product option data", async () => {
  const value = Array.from({ length: 1_000 }, (_, index) => ({
    id: `product-${index}`,
    description: "รายละเอียดสินค้า รุ่นรถที่ใช้ได้ หมายเลข OEM และคำค้นหาเพิ่มเติม ".repeat(40),
    aliases: `toyota\ndenso\n447500-${String(index).padStart(4, "0")}`,
  }));
  const rawLength = JSON.stringify(value).length;
  const payload = await compressJsonForCache(value);

  assert.ok(rawLength > 2 * 1024 * 1024);
  assert.ok(payload.length < 2 * 1024 * 1024);
  assert.ok(payload.length < rawLength / 4);
});

test("invalid compressed cache payload is rejected", async () => {
  await assert.rejects(() => decompressJsonFromCache("not-a-gzip-payload"));
});
