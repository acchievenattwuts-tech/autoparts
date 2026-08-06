/**
 * Attribution pass for the two slowest report queries.
 *
 * Read-only: timings, row counts and EXPLAIN ANALYZE on SELECTs only.
 * Nothing here writes, and no schema object is created or dropped.
 *
 * Usage: npm run diagnose:slow-reports -- [days]
 */
import { db } from "../lib/db";
import { getLatestStockBalances } from "../lib/stock-card-latest-balance";
import { formatDateOnlyForInput, getThailandDateKey, parseDateOnlyToDate } from "../lib/th-date";

const DEFAULT_RANGE_DAYS = 90;
const STOCK_TAKE = 1000;

const time = async <T,>(label: string, run: () => Promise<T>): Promise<T> => {
  const startedAt = performance.now();
  const result = await run();
  const elapsed = performance.now() - startedAt;
  const rows = Array.isArray(result) ? result.length : result instanceof Map ? result.size : 1;
  console.log(`  ${label.padEnd(42)} ${elapsed.toFixed(1).padStart(8)}ms  rows=${rows}`);
  return result;
};

const explain = async (label: string, sql: string): Promise<void> => {
  const plan = await db.$queryRawUnsafe<Array<Record<string, string>>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
  );
  console.log(`\n--- EXPLAIN: ${label}`);
  for (const line of plan) {
    console.log("   " + Object.values(line)[0]);
  }
};

const main = async (): Promise<void> => {
  const rangeDays = Number(process.argv[2]) || DEFAULT_RANGE_DAYS;
  const today = parseDateOnlyToDate(getThailandDateKey());
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - rangeDays);
  const fromStr = formatDateOnlyForInput(fromDate);
  const toStr = getThailandDateKey(today);
  const from = parseDateOnlyToDate(fromStr);
  const to = parseDateOnlyToDate(toStr);

  console.log(`=== Table sizes ===`);
  const [productCount, activeProductCount, stockCardCount, saleCount, receiptCount] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { isActive: true } }),
    db.stockCard.count(),
    db.sale.count(),
    db.receipt.count(),
  ]);
  console.log(`  Product            ${productCount} (active ${activeProductCount})`);
  console.log(`  StockCard          ${stockCardCount}`);
  console.log(`  Sale               ${saleCount}`);
  console.log(`  Receipt            ${receiptCount}`);

  console.log(`\n=== queryStockRows breakdown ===`);
  const products = await time("product.findMany (take 1000)", () =>
    db.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
      take: STOCK_TAKE,
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        avgCost: true,
        reportUnitName: true,
        minStock: true,
        units: { select: { name: true, scale: true, isBase: true } },
        category: { select: { name: true } },
      },
    }),
  );
  await time("getLatestStockBalances (DISTINCT ON)", () =>
    getLatestStockBalances(products.map((p) => p.id)),
  );

  console.log(`\n=== getReportsData sub-queries (${fromStr} .. ${toStr}) ===`);
  const dateRange = { gte: from, lte: to };
  await time("sale.findMany (+items)", () =>
    db.sale.findMany({
      where: { status: "ACTIVE", saleDate: dateRange },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true, saleNo: true, saleDate: true, customerName: true, netAmount: true,
        vatAmount: true, amountRemain: true, paymentType: true, paymentMethod: true, note: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
        items: { select: { quantity: true, costPrice: true, lineDiscount: true } },
      },
    }),
  );
  await time("creditNote.findMany (+sale.items)", () =>
    db.creditNote.findMany({
      where: { status: "ACTIVE", type: "RETURN", cnDate: dateRange },
      orderBy: [{ cnDate: "asc" }, { cnNo: "asc" }],
      select: {
        id: true, cnNo: true, cnDate: true, customerName: true, totalAmount: true,
        vatAmount: true, note: true, settlementType: true, refundMethod: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
        sale: { select: { items: { select: { productId: true, quantity: true, costPrice: true } } } },
        items: { select: { productId: true, qty: true, amount: true, product: { select: { avgCost: true } } } },
      },
    }),
  );
  await time("purchase.findMany", () =>
    db.purchase.findMany({
      where: { status: "ACTIVE", purchaseDate: dateRange },
      orderBy: [{ purchaseDate: "asc" }, { purchaseNo: "asc" }],
      select: {
        id: true, purchaseNo: true, purchaseDate: true, purchaseType: true, paymentMethod: true,
        cashBankAccountId: true, referenceNo: true, note: true, supplierId: true,
        cashBankAccount: { select: { name: true } }, supplier: { select: { code: true, name: true } },
        netAmount: true, amountRemain: true, vatAmount: true,
      },
    }),
  );
  await time("expense.findMany (+items)", () =>
    db.expense.findMany({
      where: { status: "ACTIVE", expenseDate: dateRange },
      orderBy: [{ expenseDate: "asc" }, { expenseNo: "asc" }],
      select: {
        id: true, expenseNo: true, expenseDate: true, note: true, totalAmount: true,
        vatAmount: true, netAmount: true,
        cashBankAccount: { select: { name: true } },
        items: { select: { amount: true, description: true, expenseCode: { select: { code: true, name: true } } } },
      },
    }),
  );
  await time("product.findMany (NO take)", () =>
    db.product.findMany({
      where: { isActive: true },
      orderBy: [{ stock: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, name: true, stock: true, minStock: true, avgCost: true,
        category: { select: { name: true } },
      },
    }),
  );
  await time("receipt.findMany", () =>
    db.receipt.findMany({
      where: { status: "ACTIVE", receiptDate: dateRange },
      orderBy: [{ receiptDate: "asc" }, { receiptNo: "asc" }],
      select: {
        id: true, receiptNo: true, receiptDate: true, customerName: true, paymentMethod: true,
        totalAmount: true, note: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
      },
    }),
  );
  await time("sale.findMany (outstanding)", () =>
    db.sale.findMany({
      where: { status: "ACTIVE", amountRemain: { gt: 0 }, saleDate: dateRange },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true, saleNo: true, saleDate: true, customerName: true, amountRemain: true,
        paymentType: true, fulfillmentType: true, shippingStatus: true,
        customer: { select: { code: true, name: true } },
      },
    }),
  );

  const productIds = products.map((p) => p.id);
  await explain(
    "DISTINCT ON latest stock balance",
    `SELECT DISTINCT ON ("productId") "productId", "qtyBalance", "priceBalance"
     FROM "StockCard"
     WHERE "productId" = ANY(ARRAY[${productIds.map((id) => `'${id}'`).join(",")}]::text[])
     ORDER BY "productId", "docDate" DESC, sorder DESC`,
  );
  await explain(
    "Product list ordered by category name",
    `SELECT p."id", p."code", p."name", p."stock", p."avgCost"
     FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId"
     WHERE p."isActive" = true
     ORDER BY c."name" ASC, p."code" ASC
     LIMIT ${STOCK_TAKE}`,
  );
};

main()
  .catch((error: unknown) => {
    console.error("diagnosis failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
