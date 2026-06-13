import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import generatedPrisma from "../lib/generated/prisma/index.js";

const { PrismaClient, Prisma } = generatedPrisma;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const SOURCE_DIR = path.join(process.cwd(), "import", "latest_import_csv_set");
const IMPORT_LABEL = "latest_import_csv_set";
const SALE_PRICE = 0;
const BASE_CATEGORY = "ท่อยางหม้อน้ำ (Radiator Hose)";

const CONFIRMED_NEW_MASTER = {
  categories: ["ท่อยางหม้อน้ำ (Radiator Hose)"],
  partsBrands: ["DKR", "SKR"],
  carBrands: [],
  carModels: [["Ford", "Focus"]],
};

const PRODUCT_NAME_OVERRIDES = {
  P003: "ท่อยางหม้อน้ำ NISSAN DKR NP300 เครื่อง YD25 ท่อบน (W3-4067)",
  P004: "ท่อยางหม้อน้ำ NISSAN DKR NP300 เครื่อง YD25 ท่อล่าง (W3-4068)",
  P005: "ท่อยางหม้อน้ำ NISSAN DKR ท่อบน NP300, YD25 (W3-4069)",
  P042: "ท่อยางหม้อน้ำ ISUZU DKR D-MAX 1.9 ปี 2020 ท่อบน (W3-5048)",
  P043: "ท่อยางหม้อน้ำ ISUZU DKR D-MAX All New เครื่อง 4JK1 ปี 2014 ท่อบน (W3-5043)",
  P044: "ท่อยางหม้อน้ำ ISUZU DKR D-MAX All New เครื่อง 4JK1 ปี 2014 ท่อล่าง (W3-5044)",
  P078: "ท่อยางหม้อน้ำ TRITON DKR ท่อล่าง (W3-6257)",
  P100: "ท่อยางหม้อน้ำ MAZDA DKR BT-50 Pro 3.2 ปี 2011 ท่อล่าง 1 (W3-1055)",
  P101: "ท่อยางหม้อน้ำ MAZDA DKR Mazda BT-50 Pro 3.2 ปี2011 ท่อล่าง 2 (W3-1056)",
  P122: "ท่อยางหม้อน้ำ KDH22 เครื่อง 2TR เบนซิน (W03-2516)",
  P123: "ท่อยางหม้อน้ำ TOYOTA SKR Commuter 2.5 ดีเซล M/T ล่างฝั่งเครื่อง (W7-2809)",
  P113: "ท่อยางหม้อน้ำ TOYOTA SKR Fortuner 2.5 ดีเซล ท่อบน (16570L030)",
  P114: "ท่อยางหม้อน้ำ TOYOTA SKR Fortuner 2.5 ดีเซล ท่อล่าง (165710L30)",
  P115: "ท่อยางหม้อน้ำ TOYOTA SKR Revo 2.7 ท่อบน (165710C140)",
  P116: "ท่อยางหม้อน้ำ TOYOTA SKR Revo 2.7 ท่อล่าง (165720C140)",
  P117: "ท่อยางหม้อน้ำ ISUZU SKR Dragon eyes 2.5 ท่อบน (SISRDH-039)",
  P118: "ท่อยางหม้อน้ำ ISUZU SKR Dragon eyes 2.5 ท่อล่าง (SISRDH-040)",
  P119: "ท่อยางหม้อน้ำ TOYOTA SKR Tiger 2L 2.4 ท่อบน (165710L010)",
  P120: "ท่อยางหม้อน้ำ TOYOTA SKR Tiger 2L 2.4 ท่อล่าง (165720L010)",
  P121: "ท่อยางหม้อน้ำ TOYOTA SKR Commuter 2.5 ดีเซล M/T บนฝั่งเครื่อง (STORDH-090)",
  P124: "ท่อยางหม้อน้ำ TOYOTA SKR Commuter 2.5 ดีเซล M/T ล่างฝั่งหม้อน้ำ (1657430020)",
  P125: "ท่อยางหม้อน้ำ TOYOTA SKR Commuter 2.5 ดีเซล M/T บนระหว่างหม้อน้ำ (STORDH-474)",
};

const MODEL_KEY_MAP = {
  "CHEVROLET||Colorado": "Chevrolet||Colorado",
  "CHEVROLET||Captiva": "Chevrolet||Captiva",
  "FORD||Fiesta": "Ford||Fiesta",
  "FORD||Focus": "Ford||Focus",
  "HONDA||CR-V": "Honda||CRV",
  "HONDA||HR-V": "Honda||HRV",
  "HONDA||BR-V": "Honda||BRV",
  "HYUNDAI||H-1": "HYUNDAI||H-1",
  "ISUZU||D-MAX": "Isuzu||D-Max",
  "ISUZU||Dragon Eyes": "Isuzu||DRAGON EYE",
  "MAZDA||BT-50": "Mazda||BT-50",
  "MAZDA||BT-50 Pro": "Mazda||BT-50 Pro",
  "MAZDA||Mazda 2": "Mazda||Mazda2",
  "MITSUBISHI||Triton": "Mitsubishi||Triton",
  "NISSAN||NP300": "Nissan||NP300",
  "TOYOTA||Camry": "Toyota||Camry",
  "TOYOTA||C-HR": "Toyota||CHR",
  "TOYOTA||Commuter": "Toyota||Hiace Commuter",
  "TOYOTA||Corolla Altis": "Toyota||Altis",
  "TOYOTA||Hilux Revo": "Toyota||Hilux Revo",
  "TOYOTA||Hilux Tiger": "Toyota||Tiger",
  "TOYOTA||Soluna": "Toyota||SOLUNA",
  "TOYOTA||Vigo": "Toyota||Hilux Vigo",
};

const CAR_BRAND_NAMES = {
  CHEVROLET: "Chevrolet",
  FORD: "Ford",
  HONDA: "Honda",
  HYUNDAI: "HYUNDAI",
  ISUZU: "Isuzu",
  MAZDA: "Mazda",
  MITSUBISHI: "Mitsubishi",
  NISSAN: "Nissan",
  TOYOTA: "Toyota",
};

const ALIAS_KINDS = new Set(["ALIAS", "OEM", "PART_NO", "CROSS_REF", "KEYWORD", "MISSPELL", "EN", "TH"]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const modes = argv.filter((arg) => arg === "--dry-run" || arg === "--execute");
  if (modes.length !== 1) fail("Choose exactly one mode: --dry-run or --execute");
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm-latest-code="));
  return {
    mode: modes[0] === "--dry-run" ? "dry-run" : "execute",
    confirmedLatestCode: confirmArg ? confirmArg.slice("--confirm-latest-code=".length) : null,
  };
}

function parseCsv(text, fileLabel) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (quoted) {
      if (ch === "\"" && normalized[i + 1] === "\"") {
        value += "\"";
        i += 1;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      row.push(value);
      value = "";
    } else if (ch === "\n") {
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }

  if (quoted) fail(`Unclosed quoted CSV value in ${fileLabel}`);
  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  if (rows.length === 0) fail(`CSV file is empty: ${fileLabel}`);

  const headers = rows[0];
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      fail(`${fileLabel} row ${index + 2} has ${cells.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
  });
}

function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(SOURCE_DIR, name), "utf8"), name);
}

function requireColumns(rows, fileLabel, columns) {
  const first = rows[0] || {};
  const missing = columns.filter((column) => !(column in first));
  if (missing.length > 0) fail(`${fileLabel} is missing columns: ${missing.join(", ")}`);
}

function uniqueByKey(rows, keyFn) {
  const seen = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!seen.has(key)) seen.set(key, row);
  }
  return Array.from(seen.values());
}

function parseProductCode(code) {
  const match = /^P(\d+)$/.exec(code);
  return match ? Number(match[1]) : null;
}

function formatProductCode(number) {
  return `P${String(number).padStart(4, "0")}`;
}

function latestCode(codes) {
  const numbers = codes.map(parseProductCode).filter((number) => number !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  return { code: max > 0 ? formatProductCode(max) : null, number: max };
}

function normalizeSlugSegment(value) {
  return value
    .normalize("NFC")
    .replace(/([\u0E48-\u0E4C])\u0E4D\u0E32/gu, "$1\u0E33")
    .replace(/\u0E4D\u0E32/gu, "\u0E33")
    .toLowerCase()
    .trim();
}

function slugifySegment(value) {
  return (
    normalizeSlugSegment(value)
      .replace(/[\u0027\u2019]+/g, "")
      .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function buildUniqueSlug({ value, taken, fallback, extraCandidates = [] }) {
  const base = slugifySegment(value) || fallback;
  const candidates = [base, ...extraCandidates.map((item) => slugifySegment(item) || fallback).filter((item) => item !== base)];
  for (const candidate of candidates) {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  const result = `${base}-${suffix}`;
  taken.add(result);
  return result;
}

function toOptionalText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function parseOptionalYear(value, label) {
  if (!toOptionalText(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1900 || number > 2200) {
    fail(`Invalid year in ${label}: ${value}`);
  }
  return number;
}

function listMissing(existing, required) {
  return required.filter((value) => !existing.has(value));
}

function normalizedCarModelKey(carBrandName, carModelName) {
  const rawKey = `${carBrandName}||${carModelName}`;
  return MODEL_KEY_MAP[rawKey] || `${CAR_BRAND_NAMES[carBrandName] || carBrandName}||${carModelName}`;
}

async function getProductionSnapshot(db) {
  const [products, categories, partsBrands, carBrands, carModels] = await Promise.all([
    db.product.findMany({ select: { code: true, slug: true } }),
    db.category.findMany({ select: { id: true, name: true, isActive: true } }),
    db.partsBrand.findMany({ select: { id: true, name: true, isActive: true } }),
    db.carBrand.findMany({ select: { id: true, name: true, isActive: true } }),
    db.carModel.findMany({ select: { id: true, name: true, isActive: true, carBrand: { select: { name: true } } } }),
  ]);
  return { products, categories, partsBrands, carBrands, carModels };
}

function buildInputData(files, snapshot) {
  const { products, aliases, fitments } = files;
  requireColumns(products, "products.csv", [
    "import_key", "name", "description", "category_name", "brand_name",
    "costPrice", "purchaseUnitName", "saleUnitName", "reportUnitName",
  ]);
  requireColumns(aliases, "product_aliases.csv", ["import_key", "kind", "alias"]);
  requireColumns(fitments, "product_fitments.csv", [
    "import_key", "car_brand_name", "car_model_name", "submodel", "yearStart", "yearEnd", "engineCode", "engineSize", "note",
  ]);

  const importKeys = new Set(products.map((row) => row.import_key));
  if (importKeys.size !== products.length) fail("products.csv contains duplicate import_key values");

  const unknownAliasKeys = aliases.filter((row) => !importKeys.has(row.import_key)).map((row) => row.import_key);
  const unknownFitmentKeys = fitments.filter((row) => !importKeys.has(row.import_key)).map((row) => row.import_key);
  if (unknownAliasKeys.length) fail(`Aliases refer to unknown products: ${Array.from(new Set(unknownAliasKeys)).join(", ")}`);
  if (unknownFitmentKeys.length) fail(`Fitments refer to unknown products: ${Array.from(new Set(unknownFitmentKeys)).join(", ")}`);

  const currentLatest = latestCode(snapshot.products.map((row) => row.code));
  const existingCodes = new Set(snapshot.products.map((row) => row.code));
  const productSlugs = new Set(snapshot.products.map((row) => row.slug).filter(Boolean));
  const categoriesRequired = new Set();
  const brandsRequired = new Set();

  const productRows = products.map((row, index) => {
    if (row.category_name !== "ท่อยางหม้อน้ำ") fail(`Unexpected category for ${row.import_key}: ${row.category_name}`);
    categoriesRequired.add(BASE_CATEGORY);

    const finalName = PRODUCT_NAME_OVERRIDES[row.import_key] || row.name;
    const brandName = toOptionalText(row.brand_name);
    if (brandName) brandsRequired.add(brandName);

    const costPrice = Number(row.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) fail(`Invalid costPrice for ${row.import_key}: ${row.costPrice}`);

    const code = formatProductCode(currentLatest.number + index + 1);
    if (existingCodes.has(code)) fail(`Generated product code already exists: ${code}`);

    return {
      importKey: row.import_key,
      code,
      name: finalName,
      description: toOptionalText(row.description),
      categoryName: BASE_CATEGORY,
      brandName,
      costPrice,
      salePrice: SALE_PRICE,
      purchaseUnitName: row.purchaseUnitName,
      saleUnitName: row.saleUnitName,
      reportUnitName: row.reportUnitName,
      slug: buildUniqueSlug({ value: finalName, taken: productSlugs, fallback: "product", extraCandidates: [code] }),
    };
  });

  const aliasRows = uniqueByKey(
    aliases.map((row) => {
      if (!ALIAS_KINDS.has(row.kind)) fail(`Unsupported alias kind ${row.kind} for ${row.import_key}`);
      const alias = toOptionalText(row.alias);
      if (!alias) fail(`Empty alias for ${row.import_key}`);
      const weight = toOptionalText(row.weight) ? Number(row.weight) : null;
      if (weight !== null && !Number.isInteger(weight)) fail(`Invalid alias weight for ${row.import_key}: ${row.weight}`);
      return { importKey: row.import_key, kind: row.kind, alias, weight };
    }),
    (row) => `${row.importKey}||${row.kind}||${row.alias}`,
  );

  const modelKeysRequired = new Set();
  const fitmentRows = uniqueByKey(
    fitments.map((row) => {
      const modelKey = normalizedCarModelKey(row.car_brand_name, row.car_model_name);
      modelKeysRequired.add(modelKey);
      return {
        importKey: row.import_key,
        modelKey,
        submodel: toOptionalText(row.submodel),
        yearStart: parseOptionalYear(row.yearStart, row.import_key),
        yearEnd: parseOptionalYear(row.yearEnd, row.import_key),
        engineCode: toOptionalText(row.engineCode),
        engineSize: toOptionalText(row.engineSize),
        note: toOptionalText(row.note),
      };
    }),
    (row) => [
      row.importKey,
      row.modelKey,
      row.submodel,
      row.yearStart,
      row.yearEnd,
      row.engineCode,
      row.engineSize,
      row.note,
    ].join("||"),
  );

  const existingCategoryNames = new Set(snapshot.categories.filter((row) => row.isActive).map((row) => row.name));
  const existingBrandNames = new Set(snapshot.partsBrands.filter((row) => row.isActive).map((row) => row.name));
  const existingCarBrandNames = new Set(snapshot.carBrands.filter((row) => row.isActive).map((row) => row.name));
  const existingModelKeys = new Set(snapshot.carModels.filter((row) => row.isActive).map((row) => `${row.carBrand.name}||${row.name}`));

  const missing = {
    categories: listMissing(existingCategoryNames, Array.from(categoriesRequired)),
    partsBrands: listMissing(existingBrandNames, Array.from(brandsRequired)),
    carBrands: listMissing(existingCarBrandNames, Array.from(modelKeysRequired).map((key) => key.split("||")[0])),
    carModels: listMissing(existingModelKeys, Array.from(modelKeysRequired)),
  };
  missing.carBrands = Array.from(new Set(missing.carBrands));

  const allowedNew = {
    categories: new Set(CONFIRMED_NEW_MASTER.categories),
    partsBrands: new Set(CONFIRMED_NEW_MASTER.partsBrands),
    carBrands: new Set(CONFIRMED_NEW_MASTER.carBrands),
    carModels: new Set(CONFIRMED_NEW_MASTER.carModels.map(([brand, model]) => `${brand}||${model}`)),
  };
  const unexpected = {
    categories: missing.categories.filter((name) => !allowedNew.categories.has(name)),
    partsBrands: missing.partsBrands.filter((name) => !allowedNew.partsBrands.has(name)),
    carBrands: missing.carBrands.filter((name) => !allowedNew.carBrands.has(name)),
    carModels: missing.carModels.filter((key) => !allowedNew.carModels.has(key)),
  };

  return {
    currentLatest,
    productRows,
    aliasRows,
    fitmentRows,
    missing,
    unexpected,
  };
}

async function ensureConfirmedMasters(tx, missing) {
  for (const name of missing.categories) {
    await tx.category.create({ data: { name } });
  }
  for (const name of missing.partsBrands) {
    await tx.partsBrand.create({ data: { name } });
  }
  for (const name of missing.carBrands) {
    await tx.carBrand.create({ data: { name } });
  }

  const carBrands = await tx.carBrand.findMany({ select: { id: true, name: true } });
  const carBrandIds = new Map(carBrands.map((row) => [row.name, row.id]));
  for (const modelKey of missing.carModels) {
    const [carBrandName, name] = modelKey.split("||");
    const carBrandId = carBrandIds.get(carBrandName);
    if (!carBrandId) fail(`Unable to create car model because brand is missing: ${modelKey}`);
    await tx.carModel.create({ data: { carBrandId, name } });
  }
}

async function executeImport(db, data, confirmedLatestCode) {
  if (!confirmedLatestCode) fail("Execute mode requires --confirm-latest-code=Pxxxx from the reviewed dry-run output");
  if (confirmedLatestCode !== data.currentLatest.code) {
    fail(`Confirmed latest code ${confirmedLatestCode} does not match current production ${data.currentLatest.code}`);
  }
  if (Object.values(data.unexpected).some((rows) => rows.length > 0)) {
    fail(`Cannot execute with unexpected missing master data: ${JSON.stringify(data.unexpected)}`);
  }

  await db.$transaction(async (tx) => {
    const latestInsideTransaction = latestCode((await tx.product.findMany({ select: { code: true } })).map((row) => row.code));
    if (latestInsideTransaction.code !== confirmedLatestCode) {
      fail(`Production code changed before execute: expected ${confirmedLatestCode}, found ${latestInsideTransaction.code}`);
    }

    await ensureConfirmedMasters(tx, data.missing);

    const [categories, partsBrands, carModels] = await Promise.all([
      tx.category.findMany({ select: { id: true, name: true } }),
      tx.partsBrand.findMany({ select: { id: true, name: true } }),
      tx.carModel.findMany({ select: { id: true, name: true, carBrand: { select: { name: true } } } }),
    ]);
    const categoryIds = new Map(categories.map((row) => [row.name, row.id]));
    const brandIds = new Map(partsBrands.map((row) => [row.name, row.id]));
    const carModelIds = new Map(carModels.map((row) => [`${row.carBrand.name}||${row.name}`, row.id]));
    const productIds = new Map();

    for (const row of data.productRows) {
      const product = await tx.product.create({
        data: {
          code: row.code,
          slug: row.slug,
          name: row.name,
          description: row.description,
          categoryId: categoryIds.get(row.categoryName),
          brandId: row.brandName ? (brandIds.get(row.brandName) ?? null) : null,
          costPrice: new Prisma.Decimal(row.costPrice),
          salePrice: new Prisma.Decimal(row.salePrice),
          stock: 0,
          minStock: 1,
          warrantyDays: 0,
          purchaseUnitName: row.purchaseUnitName,
          saleUnitName: row.saleUnitName,
          reportUnitName: row.reportUnitName,
          inventoryTracking: "TRACKED",
          isLotControl: false,
          requireExpiryDate: false,
          allowExpiredIssue: false,
          lotIssueMethod: "FIFO",
          units: {
            create: {
              name: row.purchaseUnitName,
              scale: 1,
              isBase: true,
            },
          },
        },
        select: { id: true },
      });
      productIds.set(row.importKey, product.id);
    }

    await tx.productAlias.createMany({
      data: data.aliasRows.map((row) => ({
        productId: productIds.get(row.importKey),
        kind: row.kind,
        alias: row.alias,
        weight: row.weight,
      })),
      skipDuplicates: true,
    });

    await tx.productFitment.createMany({
      data: data.fitmentRows.map((row) => ({
        productId: productIds.get(row.importKey),
        carModelId: carModelIds.get(row.modelKey),
        submodel: row.submodel,
        yearStart: row.yearStart,
        yearEnd: row.yearEnd,
        engineCode: row.engineCode,
        engineSize: row.engineSize,
        note: row.note,
      })),
      skipDuplicates: true,
    });
  }, { timeout: 120_000 });
}

function backfillImportedEmbeddings(data) {
  const fromCode = data.productRows[0]?.code;
  const toCode = data.productRows.at(-1)?.code;
  if (!fromCode || !toCode) return;

  const result = spawnSync(
    "npx",
    [
      "tsx",
      "--env-file=.env.local",
      "prisma/scripts/backfill-embeddings-range.ts",
      `--from-code=${fromCode}`,
      `--to-code=${toCode}`,
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Embedding backfill failed with exit code ${result.status ?? "unknown"}`);
  }
}

function printSummary(mode, data) {
  console.log(`Mode: ${mode}`);
  console.log(`Production latest product code: ${data.currentLatest.code || "(none)"}`);
  console.log(`Proposed imported product codes: ${data.productRows[0]?.code} to ${data.productRows.at(-1)?.code}`);
  console.log(`Products: ${data.productRows.length}`);
  console.log(`Aliases after dedupe: ${data.aliasRows.length}`);
  console.log(`Fitments after dedupe: ${data.fitmentRows.length}`);
  console.log(`Category mapping: ${BASE_CATEGORY}`);
  console.log(`Sale price fixed at: ${SALE_PRICE}`);
  console.log(`Missing parts brands: ${data.missing.partsBrands.join(", ") || "(none)"}`);
  console.log(`Missing car brands: ${data.missing.carBrands.join(", ") || "(none)"}`);
  console.log(`Missing car models: ${data.missing.carModels.join(", ") || "(none)"}`);
  console.log(`Unexpected missing categories: ${data.unexpected.categories.join(", ") || "(none)"}`);
  console.log(`Unexpected missing parts brands: ${data.unexpected.partsBrands.join(", ") || "(none)"}`);
  console.log(`Unexpected missing car brands: ${data.unexpected.carBrands.join(", ") || "(none)"}`);
  console.log(`Unexpected missing car models: ${data.unexpected.carModels.join(", ") || "(none)"}`);
  if (mode === "dry-run") {
    console.log(`Execute guard: --confirm-latest-code=${data.currentLatest.code}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }) });

  try {
    const files = {
      products: readCsv("products.csv"),
      aliases: readCsv("product_aliases.csv"),
      fitments: readCsv("product_fitments.csv"),
    };
    const data = buildInputData(files, await getProductionSnapshot(db));
    printSummary(args.mode, data);
    if (args.mode === "execute") {
      await executeImport(db, data, args.confirmedLatestCode);
      backfillImportedEmbeddings(data);
      console.log(`Import completed for ${IMPORT_LABEL}.`);
    } else {
      console.log("Dry-run completed. No database rows were written.");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Import validation failed: ${error.message}`);
  process.exitCode = 1;
});
