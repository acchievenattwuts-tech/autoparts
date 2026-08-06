/**
 * End-to-end check that the rewritten stock section of getReportsData still
 * returns the same values as the original "load every product" implementation.
 *
 * The original derivation is reproduced here from the product table so the two
 * can be diffed on live data. Money totals are compared both raw and at the
 * 2-decimal precision the UI renders, because Postgres sums stock * avgCost as
 * exact numeric while the old in-memory reduce accumulated float drift.
 *
 * Read-only. Usage: npm run verify:reports-stock-section
 */
import { db } from "../lib/db";
import { getReportsData, parseReportFilters } from "../lib/reports";
import { formatDateOnlyForInput, getThailandDateKey, parseDateOnlyToDate } from "../lib/th-date";

const DEFAULT_RANGE_DAYS = 90;

const toNumber = (value: unknown): number => Number(value ?? 0);
const round2 = (value: number): number => Math.round(value * 100) / 100;

const loadOriginalStockSection = async () => {
  const products = await db.product.findMany({
    where: { isActive: true },
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

  const stockRows = products.map((product) => {
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

  return {
    activeProductCount: stockRows.length,
    totalUnitsOnHand: stockRows.reduce((sum, row) => sum + row.stock, 0),
    totalStockValue: stockRows.reduce((sum, row) => sum + row.stockValue, 0),
    lowStockCount: lowStockItems.length,
    lowStockItems: lowStockItems.slice(0, 100),
    highestValueItems: [...stockRows].sort((a, b) => b.stockValue - a.stockValue).slice(0, 20),
  };
};

const main = async (): Promise<void> => {
  const today = parseDateOnlyToDate(getThailandDateKey());
  const from = new Date(today);
  from.setDate(from.getDate() - DEFAULT_RANGE_DAYS);
  const filters = parseReportFilters({
    from: formatDateOnlyForInput(from),
    to: getThailandDateKey(today),
  });

  const startedAt = performance.now();
  const report = await getReportsData(filters);
  const wallMs = performance.now() - startedAt;
  const original = await loadOriginalStockSection();
  const current = report.stock;

  const failures: string[] = [];
  const check = (label: string, oldValue: unknown, newValue: unknown): void => {
    const same = JSON.stringify(oldValue) === JSON.stringify(newValue);
    console.log(`  ${same ? "OK  " : "DIFF"}  ${label}`);
    if (!same) {
      failures.push(label);
      console.log(`        old: ${JSON.stringify(oldValue)?.slice(0, 200)}`);
      console.log(`        new: ${JSON.stringify(newValue)?.slice(0, 200)}`);
    }
  };

  console.log(`=== getReportsData stock section (wall ${wallMs.toFixed(1)}ms) ===`);
  check("activeProductCount", original.activeProductCount, current.activeProductCount);
  check("totalUnitsOnHand", original.totalUnitsOnHand, current.totalUnitsOnHand);
  check("totalStockValue @2dp", round2(original.totalStockValue), round2(current.totalStockValue));
  check("lowStockCount", original.lowStockCount, current.lowStockCount);
  check("lowStockItems", original.lowStockItems, current.lowStockItems);
  check("highestValueItems", original.highestValueItems, current.highestValueItems);

  const rawDelta = Math.abs(original.totalStockValue - current.totalStockValue);
  console.log(`  note: totalStockValue raw delta = ${rawDelta} (float drift in the old reduce)`);

  console.log(failures.length === 0 ? "\nALL VALUES MATCH" : `\nMISMATCHES: ${failures.join(", ")}`);
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
