import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCarBrandVariantLookup,
  getCachedCarBrandVariantLookup,
  invalidateCarBrandAliasCache,
  type CarBrandAliasRow,
} from "@/lib/car-brand-alias-cache";

const rows: CarBrandAliasRow[] = [
  { alias: "โตโยต้า", isActive: true, carBrand: { name: "Toyota", isActive: true } },
  { alias: "โตโยตา", isActive: true, carBrand: { name: "Toyota", isActive: true } },
  { alias: "ฮอนด้า", isActive: true, carBrand: { name: "Honda", isActive: true } },
  { alias: "ปิดอยู่", isActive: false, carBrand: { name: "Toyota", isActive: true } },
  { alias: "ยี่ห้อปิด", isActive: true, carBrand: { name: "Dead", isActive: false } },
];

test("builds a spelling→variants lookup including the canonical brand name", () => {
  const lookup = buildCarBrandVariantLookup(rows);
  // English canonical name is auto-included as a key
  assert.ok(lookup.get("toyota")?.includes("โตโยต้า"));
  // Thai spelling resolves to the same brand's full variant set
  assert.deepEqual(lookup.get("โตโยต้า")?.sort(), lookup.get("toyota")?.sort());
  assert.ok(lookup.get("ฮอนด้า")?.includes("honda"));
});

test("excludes inactive aliases and inactive brands", () => {
  const lookup = buildCarBrandVariantLookup(rows);
  assert.equal(lookup.has("ปิดอยู่"), false);
  assert.equal(lookup.has("ยี่ห้อปิด"), false);
  assert.equal(lookup.has("dead"), false);
});

test("cache returns the same lookup within the TTL, reloads after invalidation", async () => {
  invalidateCarBrandAliasCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return rows;
  };
  const now = () => 1_000;
  await getCachedCarBrandVariantLookup(loader, { now });
  await getCachedCarBrandVariantLookup(loader, { now });
  assert.equal(loads, 1, "second call served from cache");

  invalidateCarBrandAliasCache();
  await getCachedCarBrandVariantLookup(loader, { now });
  assert.equal(loads, 2, "reloads after invalidation");
});