import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(__dirname, "..");

async function loadFitmentModule() {
  const modulePath = path.join(repoRoot, "lib", "admin-product-fitment.ts");
  return import(pathToFileURL(modulePath).href);
}

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

async function run() {
  const mod = await loadFitmentModule();
  const { buildAdminProductFitmentSummary } = mod;

  const summary = buildAdminProductFitmentSummary([
    {
      carModel: { name: "Vios", carBrand: { name: "Toyota" } },
      yearStart: 2007,
      yearEnd: 2013,
    },
    {
      carModel: { name: "Vios", carBrand: { name: "Toyota" } },
      yearStart: 2007,
      yearEnd: 2013,
    },
    {
      carModel: { name: "Yaris", carBrand: { name: "Toyota" } },
      yearStart: 2014,
      yearEnd: 2017,
    },
  ]);

  assert.deepEqual(summary.lines, [
    "Toyota Vios 2007 - 2013",
    "Toyota Yaris 2014 - 2017",
  ]);
  assert.equal(summary.hiddenCount, 0);

  const overflowSummary = buildAdminProductFitmentSummary([
    { carModel: { name: "Civic", carBrand: { name: "Honda" } }, yearStart: 2012, yearEnd: 2015 },
    { carModel: { name: "City", carBrand: { name: "Honda" } }, yearStart: 2014, yearEnd: 2019 },
    { carModel: { name: "Jazz", carBrand: { name: "Honda" } }, yearStart: 2010, yearEnd: 2013 },
  ]);

  assert.deepEqual(overflowSummary.lines, [
    "Honda Civic 2012 - 2015",
    "Honda City 2014 - 2019",
  ]);
  assert.equal(overflowSummary.hiddenCount, 1);

  const openEndedSummary = buildAdminProductFitmentSummary([
    { carModel: { name: "Hilux", carBrand: { name: "Toyota" } }, yearStart: 2019, yearEnd: null },
    { carModel: { name: "D-Max", carBrand: { name: "Isuzu" } }, yearStart: null, yearEnd: 2022 },
    { carModel: { name: "BT-50", carBrand: { name: "Mazda" } }, yearStart: null, yearEnd: null },
  ]);

  assert.deepEqual(openEndedSummary.lines, [
    "Toyota Hilux 2019 - ปัจจุบัน",
    "Isuzu D-Max ถึง 2022",
  ]);
  assert.equal(openEndedSummary.hiddenCount, 1);

  const pageSource = readRepoFile("app/admin/(protected)/products/page.tsx");
  assert.match(pageSource, /ยี่ห้อรถ/, "Products page must render the fitment column header");
  assert.match(pageSource, /buildAdminProductFitmentSummary/, "Products page must use the fitment summary helper");
  assert.match(pageSource, /carModels:\s*\{/, "Products page query must fetch fitment data");
  assert.doesNotMatch(pageSource, /เธ/, "Products page must not contain mojibake Thai text");
  assert.match(pageSource, /จัดการสินค้า/, "Products page title must remain readable Thai");
  assert.match(pageSource, /ผลการค้นหา/, "Products page summary text must remain readable Thai");

  console.log("Product master fitment column checks passed");
}

void run();
