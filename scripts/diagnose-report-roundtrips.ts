/**
 * Round-trip attribution: is the report latency in Postgres, or in the wire?
 *
 * EXPLAIN ANALYZE puts the two "slow" report queries at ~3.5ms of server
 * execution while the client measures 230-360ms, so this script counts the
 * actual statements Prisma emits and times each shape in isolation.
 *
 * Read-only. Usage: npm run diagnose:report-roundtrips
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";

const STOCK_TAKE = 1000;

const buildClient = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: [{ emit: "event", level: "query" }],
  });
};

const main = async (): Promise<void> => {
  const prisma = buildClient();
  let statementCount = 0;
  let serverMs = 0;
  const seen: string[] = [];

  prisma.$on("query", (event) => {
    statementCount += 1;
    serverMs += event.duration;
    seen.push(`${event.duration}ms  ${event.query.slice(0, 90)}`);
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    statementCount = 0;
    serverMs = 0;
    seen.length = 0;
    const startedAt = performance.now();
    const result = await fn();
    const wallMs = performance.now() - startedAt;
    const rows = Array.isArray(result) ? result.length : 1;
    console.log(
      `\n${label}\n  wall ${wallMs.toFixed(1)}ms | statements ${statementCount} | server total ${serverMs}ms | rows ${rows}`,
    );
    for (const line of seen) console.log(`    ${line}`);
  };

  // Warm the pool so the first connection handshake is not charged to a query.
  await prisma.$queryRaw`SELECT 1`;

  await run("A. product.findMany — scalars only", () =>
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }],
      take: STOCK_TAKE,
      select: { id: true, code: true, name: true, stock: true, avgCost: true },
    }),
  );

  await run("B. product.findMany — + category (1 relation)", () =>
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }],
      take: STOCK_TAKE,
      select: {
        id: true, code: true, name: true, stock: true, avgCost: true,
        category: { select: { name: true } },
      },
    }),
  );

  await run("C. product.findMany — exactly what queryStockRows asks for", () =>
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
      take: STOCK_TAKE,
      select: {
        id: true, code: true, name: true, stock: true, avgCost: true,
        reportUnitName: true, minStock: true,
        units: { select: { name: true, scale: true, isBase: true } },
        category: { select: { name: true } },
      },
    }),
  );

  await run("D. raw SELECT of the same 928 product rows", () =>
    prisma.$queryRaw`
      SELECT p."id", p."code", p."name", p."stock", p."avgCost"
      FROM "Product" p
      WHERE p."isActive" = true
      ORDER BY p."code" ASC
      LIMIT ${STOCK_TAKE}
    `,
  );

  await run("E. trivial round-trip (SELECT 1)", () => prisma.$queryRaw`SELECT 1`);

  // --- getReportsData: same 12 query shapes, to count the statements Prisma
  // actually emits for their nested selects.
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 90);
  const dateRange = { gte: from, lte: today };

  let totalStatements = 0;
  let totalWall = 0;
  const countShape = async (label: string, fn: () => Promise<unknown>) => {
    statementCount = 0;
    seen.length = 0;
    const startedAt = performance.now();
    await fn();
    const wallMs = performance.now() - startedAt;
    totalStatements += statementCount;
    totalWall += wallMs;
    console.log(`  ${label.padEnd(24)} statements ${String(statementCount).padStart(2)}  wall ${wallMs.toFixed(1).padStart(7)}ms`);
  };

  console.log("\n=== getReportsData query shapes (statements Prisma emits) ===");
  await countShape("sales", () =>
    prisma.sale.findMany({
      where: { status: "ACTIVE", saleDate: dateRange },
      select: {
        id: true, saleNo: true, netAmount: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
        items: { select: { quantity: true, costPrice: true, lineDiscount: true } },
      },
    }),
  );
  await countShape("creditNotes", () =>
    prisma.creditNote.findMany({
      where: { status: "ACTIVE", type: "RETURN", cnDate: dateRange },
      select: {
        id: true, cnNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
        sale: { select: { items: { select: { productId: true, quantity: true, costPrice: true } } } },
        items: { select: { productId: true, qty: true, product: { select: { avgCost: true } } } },
      },
    }),
  );
  await countShape("purchases", () =>
    prisma.purchase.findMany({
      where: { status: "ACTIVE", purchaseDate: dateRange },
      select: {
        id: true, purchaseNo: true, netAmount: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { code: true, name: true } },
      },
    }),
  );
  await countShape("purchaseReturns", () =>
    prisma.purchaseReturn.findMany({
      where: { status: "ACTIVE", returnDate: dateRange },
      select: {
        id: true, returnNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { code: true, name: true } },
      },
    }),
  );
  await countShape("expenses", () =>
    prisma.expense.findMany({
      where: { status: "ACTIVE", expenseDate: dateRange },
      select: {
        id: true, expenseNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        items: { select: { amount: true, expenseCode: { select: { code: true, name: true } } } },
      },
    }),
  );
  await countShape("supplierAdvances", () =>
    prisma.supplierAdvance.findMany({
      where: { status: "ACTIVE", advanceDate: dateRange },
      select: {
        id: true, advanceNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { code: true, name: true } },
      },
    }),
  );
  await countShape("supplierPayments", () =>
    prisma.supplierPayment.findMany({
      where: { status: "ACTIVE", paymentDate: dateRange },
      select: {
        id: true, paymentNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        supplier: { select: { code: true, name: true } },
      },
    }),
  );
  await countShape("products (no take)", () =>
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ stock: "asc" }, { code: "asc" }],
      select: {
        id: true, code: true, name: true, stock: true, minStock: true, avgCost: true,
        category: { select: { name: true } },
      },
    }),
  );
  await countShape("warranties (take 100)", () =>
    prisma.warranty.findMany({
      where: { endDate: { lte: today } },
      take: 100,
      select: {
        id: true, endDate: true,
        product: { select: { code: true, name: true } },
        sale: { select: { saleNo: true, customerName: true } },
        customer: { select: { name: true } },
      },
    }),
  );
  await countShape("openClaims (take 100)", () =>
    prisma.warrantyClaim.findMany({
      take: 100,
      select: {
        id: true, claimNo: true,
        warranty: {
          select: {
            customerName: true,
            product: { select: { code: true, name: true } },
            sale: { select: { saleNo: true, customerName: true } },
            customer: { select: { name: true } },
          },
        },
      },
    }),
  );
  await countShape("outstandingSales", () =>
    prisma.sale.findMany({
      where: { status: "ACTIVE", amountRemain: { gt: 0 }, saleDate: dateRange },
      select: { id: true, saleNo: true, amountRemain: true, customer: { select: { code: true, name: true } } },
    }),
  );
  await countShape("receipts", () =>
    prisma.receipt.findMany({
      where: { status: "ACTIVE", receiptDate: dateRange },
      select: {
        id: true, receiptNo: true, totalAmount: true,
        cashBankAccount: { select: { name: true } },
        customer: { select: { code: true, name: true } },
      },
    }),
  );
  console.log(`  ${"TOTAL".padEnd(24)} statements ${totalStatements}  wall(serial) ${totalWall.toFixed(1)}ms`);

  await prisma.$disconnect();
};

main().catch((error: unknown) => {
  console.error("diagnosis failed", error);
  process.exitCode = 1;
});
