/**
 * Equivalence check for the getReportsData stock section.
 *
 * getReportsData currently loads every active product (928 rows + a Category
 * round-trip) and derives the whole stock section in memory. This script runs
 * that original shape alongside the targeted replacement and diffs every value
 * the report actually exposes, so the swap can be proven value-for-value before
 * it ships.
 *
 * Read-only. Usage: npm run verify:stock-summary
 */
import { db } from "../lib/db";
import { Prisma } from "../lib/generated/prisma";

const TOP_VALUE_LIMIT = 20;
const LOW_STOCK_PREVIEW_LIMIT = 100;

type StockRow = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  stock: number;
  minStock: number;
  avgCost: number;
  stockValue: number;
};

const toNumber = (value: unknown): number => Number(value ?? 0);

/** The shape getReportsData uses today: fetch everything, derive in JS. */
const loadTheOldWay = async (codeRange: { gte?: string; lte?: string } | undefined) => {
  const products = await db.product.findMany({
    where: { isActive: true, ...(codeRange ? { code: codeRange } : {}) },
    orderBy: [{ stock: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      stock: true,
      minStock: true,
      avgCost: true,
      category: { select: { name: true } },
    },
  });

  const stockRows: StockRow[] = products.map((product) => {
    const stock = toNumber(product.stock);
    const avgCost = toNumber(product.avgCost);
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      categoryName: product.category.name,
      stock,
      minStock: toNumber(product.minStock),
      avgCost,
      stockValue: stock * avgCost,
    };
  });

  const lowStockItems = stockRows.filter((row) => row.stock <= row.minStock);
  const highestValueItems = [...stockRows]
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, TOP_VALUE_LIMIT);

  return {
    activeProductCount: stockRows.length,
    totalUnitsOnHand: stockRows.reduce((sum, row) => sum + row.stock, 0),
    totalStockValue: stockRows.reduce((sum, row) => sum + row.stockValue, 0),
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.slice(0, LOW_STOCK_PREVIEW_LIMIT),
    highestValueItems,
  };
};

/** The replacement: three targeted queries, no 928-row transfer. */
const loadTheNewWay = async (codeRange: { gte?: string; lte?: string } | undefined) => {
  const codeFilter = codeRange
    ? Prisma.sql`AND ${
        codeRange.gte ? Prisma.sql`p."code" >= ${codeRange.gte}` : Prisma.sql`TRUE`
      } AND ${codeRange.lte ? Prisma.sql`p."code" <= ${codeRange.lte}` : Prisma.sql`TRUE`}`
    : Prisma.empty;

  const [lowStockProducts, highestValueRows, totalsRows] = await Promise.all([
    db.product.findMany({
      where: {
        isActive: true,
        ...(codeRange ? { code: codeRange } : {}),
        stock: { lte: db.product.fields.minStock },
      },
      orderBy: [{ stock: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        minStock: true,
        avgCost: true,
        category: { select: { name: true } },
      },
    }),
    db.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        categoryName: string;
        stock: number;
        minStock: number;
        avgCost: number;
        stockValue: number;
      }>
    >`
      SELECT p."id", p."code", p."name", c."name" AS "categoryName",
             p."stock"::int AS "stock", p."minStock"::int AS "minStock",
             p."avgCost"::float8 AS "avgCost",
             (p."stock" * p."avgCost")::float8 AS "stockValue"
      FROM "Product" p
      JOIN "Category" c ON c."id" = p."categoryId"
      WHERE p."isActive" = true ${codeFilter}
      ORDER BY (p."stock" * p."avgCost") DESC, p."stock" ASC, p."code" ASC
      LIMIT ${TOP_VALUE_LIMIT}
    `,
    db.$queryRaw<Array<{ activeProductCount: bigint; totalUnitsOnHand: number; totalStockValue: number }>>`
      SELECT COUNT(*)::bigint AS "activeProductCount",
             COALESCE(SUM(p."stock"), 0)::float8 AS "totalUnitsOnHand",
             COALESCE(SUM(p."stock" * p."avgCost"), 0)::float8 AS "totalStockValue"
      FROM "Product" p
      WHERE p."isActive" = true ${codeFilter}
    `,
  ]);

  const lowStockItems: StockRow[] = lowStockProducts.map((product) => {
    const stock = toNumber(product.stock);
    const avgCost = toNumber(product.avgCost);
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      categoryName: product.category.name,
      stock,
      minStock: toNumber(product.minStock),
      avgCost,
      stockValue: stock * avgCost,
    };
  });

  const totals = totalsRows[0];

  return {
    activeProductCount: Number(totals?.activeProductCount ?? 0),
    totalUnitsOnHand: toNumber(totals?.totalUnitsOnHand),
    totalStockValue: toNumber(totals?.totalStockValue),
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.slice(0, LOW_STOCK_PREVIEW_LIMIT),
    highestValueItems: highestValueRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      categoryName: row.categoryName,
      stock: toNumber(row.stock),
      minStock: toNumber(row.minStock),
      avgCost: toNumber(row.avgCost),
      stockValue: toNumber(row.stockValue),
    })),
  };
};

const compare = (
  label: string,
  oldValue: unknown,
  newValue: unknown,
  failures: string[],
): void => {
  const same = JSON.stringify(oldValue) === JSON.stringify(newValue);
  console.log(`  ${same ? "OK  " : "DIFF"}  ${label}`);
  if (!same) {
    failures.push(label);
    console.log(`        old: ${JSON.stringify(oldValue)?.slice(0, 240)}`);
    console.log(`        new: ${JSON.stringify(newValue)?.slice(0, 240)}`);
  }
};

const runCase = async (
  label: string,
  codeRange: { gte?: string; lte?: string } | undefined,
  failures: string[],
): Promise<void> => {
  console.log(`\n=== ${label} ===`);

  const oldStart = performance.now();
  const oldResult = await loadTheOldWay(codeRange);
  const oldMs = performance.now() - oldStart;

  const newStart = performance.now();
  const newResult = await loadTheNewWay(codeRange);
  const newMs = performance.now() - newStart;

  compare("activeProductCount", oldResult.activeProductCount, newResult.activeProductCount, failures);
  compare("totalUnitsOnHand", oldResult.totalUnitsOnHand, newResult.totalUnitsOnHand, failures);
  compare("totalStockValue", oldResult.totalStockValue, newResult.totalStockValue, failures);
  compare("lowStockCount", oldResult.lowStockCount, newResult.lowStockCount, failures);
  compare("lowStockItems", oldResult.lowStockItems, newResult.lowStockItems, failures);
  compare("highestValueItems", oldResult.highestValueItems, newResult.highestValueItems, failures);

  console.log(`  timing: old ${oldMs.toFixed(1)}ms -> new ${newMs.toFixed(1)}ms`);
};

const main = async (): Promise<void> => {
  const failures: string[] = [];

  await runCase("no product-code filter", undefined, failures);

  const sample = await db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { code: true },
    take: 400,
  });
  const gte = sample[0]?.code;
  const lte = sample[sample.length - 1]?.code;
  if (gte && lte) {
    await runCase(`product-code range ${gte} .. ${lte}`, { gte, lte }, failures);
    await runCase(`product-code open-ended (gte ${gte})`, { gte }, failures);
  }

  console.log(
    failures.length === 0
      ? "\nALL VALUES MATCH"
      : `\nMISMATCHES: ${failures.join(", ")}`,
  );
  if (failures.length > 0) process.exitCode = 1;
};

main()
  .catch((error: unknown) => {
    console.error("verification failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
