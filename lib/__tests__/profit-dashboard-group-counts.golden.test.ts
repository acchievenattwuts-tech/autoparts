import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@/lib/generated/prisma";

/**
 * R6 (review 2026-11-12): the profit dashboard used to load every group of a section just to take
 * `.length` for the page count, and every (customer, bill) pair of the range to count the bills of the
 * ten customers on the page. Both are now SQL COUNTs. This test runs the real SQL on an in-process
 * Postgres (PGlite) and the previous algorithm — factProfit.groupBy, emulated below as the SQL GROUP BY
 * Prisma sends, on the same rows — and compares page counts and bill counts on every page, with:
 * null product codes and names, renamed products and customers, shipping lines without a product,
 * expense / other-income / inactive / out-of-range facts, and guest names that differ only by
 * spaces (including Unicode spaces), that contain another guest's name, or that are blank.
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

let pg: PGlite;

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
const toAdapterParam = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value;

type Where = {
  isActive?: boolean;
  sourceType?: string | { in: string[] };
  businessDate?: { gte?: Date; lte?: Date };
  productId?: null | { not: null } | { in: string[] };
  productName?: { not: null };
};
type GroupByArgs = {
  by: string[];
  where: Where;
  _sum?: Record<string, true>;
  orderBy?: Array<Record<string, unknown>>;
  skip?: number;
  take?: number;
};

const DECIMAL_COLUMNS = new Set(["quantity", "salesAmountExVat", "salesAmountIncVat", "costAmount", "grossProfit", "unitCostPrice"]);

function whereSql(where: Where, params: unknown[]): string {
  const bind = (value: unknown): string => {
    params.push(toAdapterParam(value));
    return `$${params.length}`;
  };
  const conditions: string[] = [];
  if (where.isActive !== undefined) conditions.push(`"isActive" = ${bind(where.isActive)}`);
  if (typeof where.sourceType === "string") conditions.push(`"sourceType"::text = ${bind(where.sourceType)}`);
  else if (where.sourceType) conditions.push(`"sourceType"::text IN (${where.sourceType.in.map(bind).join(", ")})`);
  if (where.businessDate?.gte) conditions.push(`"businessDate" >= ${bind(where.businessDate.gte)}`);
  if (where.businessDate?.lte) conditions.push(`"businessDate" <= ${bind(where.businessDate.lte)}`);
  for (const field of ["productId", "productName"] as const) {
    const filter = where[field];
    if (filter === null) conditions.push(`"${field}" IS NULL`);
    else if (filter && "not" in filter) conditions.push(`"${field}" IS NOT NULL`);
    else if (filter && "in" in filter) conditions.push(`"${field}" IN (${filter.in.map(bind).join(", ")})`);
  }
  return conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
}

const toResultValue = (column: string, value: unknown): unknown =>
  DECIMAL_COLUMNS.has(column) && value !== null && value !== undefined ? new Prisma.Decimal(String(value)) : value;

/** factProfit.groupBy as Prisma runs it: SELECT by-columns, SUMs … GROUP BY by-columns ORDER BY … OFFSET/LIMIT. */
async function emulatedGroupBy(args: GroupByArgs): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  const sums = Object.keys(args._sum ?? {});
  const select = [...args.by.map((column) => `"${column}"`), ...sums.map((column) => `SUM("${column}") AS "_sum_${column}"`)];
  const orderBy = (args.orderBy ?? []).map((entry) => {
    const [[key, value]] = Object.entries(entry);
    if (key === "_sum") {
      const [[column, direction]] = Object.entries(value as Record<string, string>);
      return `SUM("${column}") ${direction.toUpperCase()}`;
    }
    return `"${key}" ${String(value).toUpperCase()}`;
  });
  const sql = `SELECT ${select.join(", ")} FROM "FactProfit" WHERE ${whereSql(args.where, params)}
    GROUP BY ${args.by.map((column) => `"${column}"`).join(", ")}
    ${orderBy.length > 0 ? `ORDER BY ${orderBy.join(", ")}` : ""}
    ${args.take !== undefined ? `LIMIT ${args.take}` : ""} ${args.skip ? `OFFSET ${args.skip}` : ""}`;
  const rows = (await pg.query<Record<string, unknown>>(sql, params)).rows;
  return rows.map((row) => ({
    ...Object.fromEntries(args.by.map((column) => [column, row[column]])),
    ...(sums.length > 0 ? { _sum: Object.fromEntries(sums.map((column) => [column, toResultValue(column, row[`_sum_${column}`])])) } : {}),
  }));
}

async function emulatedFindMany(args: { where: Where; select: Record<string, true> }): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  const columns = Object.keys(args.select);
  const rows = (await pg.query<Record<string, unknown>>(
    `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "FactProfit" WHERE ${whereSql(args.where, params)}`, params,
  )).rows;
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, toResultValue(column, row[column])])));
}

const db = {
  factProfit: { groupBy: emulatedGroupBy, findMany: emulatedFindMany },
  supplierDebitNote: { findMany: async () => [] },
  purchaseReturn: { findMany: async () => [] },
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = Prisma.sql(strings, ...values);
    return (await pg.query(query.text, query.values.map(toAdapterParam))).rows;
  },
};

type Fact = [sourceType: string, sourceId: string, day: string, customerId: string | null, customerName: string | null,
  productId: string | null, productCode: string | null, productName: string | null, gross: number, isActive?: boolean,
  sourceSubtype?: string | null];

const GUEST_NAMES = ["ร้าน ก", "ร้าน ก ", "  ร้าน ก", "ร้าน กข", null, "", "   ", "　", "ลูกค้าไม่ระบุ", " ลูกค้าไม่ระบุ",
  "ลูกค้าไม่ระบุ2", "\tร้าน ข\n"];
const FACTS: Fact[] = [
  ["SALE", "s-1", "2026-11-02", "cust-1", "ลูกค้า A", "p-1", "A001", "สินค้า 1", 120],
  ["SALE", "s-1", "2026-11-02", "cust-1", "ลูกค้า A", null, null, null, 10],
  ["SALE", "s-2", "2026-11-03", "cust-1", "ลูกค้า A", "p-2", null, "สินค้า 2", -40],
  // One bill whose lines carry the old and the new customer name: two (name, bill) pairs.
  ["SALE", "s-3", "2026-11-04", "cust-1", "ลูกค้า A (ใหม่)", "p-1", "A001", "สินค้า 1", 80],
  ["SALE", "s-3", "2026-11-04", "cust-1", "ลูกค้า A", "p-3", "A003", null, 5],
  ["SALE_RETURN", "r-1", "2026-11-05", "cust-1", "ลูกค้า A (ใหม่)", "p-1", "A001", "สินค้า 1", -30, true, "RETURN"],
  ["SALE", "s-4", "2026-11-05", "cust-2", "ลูกค้า B", "p-4", "A004", "สินค้า 4", 3],
  ["SALE", "s-5", "2026-11-06", "cust-2", "ลูกค้า B", "p-4", "A004", "สินค้า 4 (ชื่อใหม่)", 4],
  ...GUEST_NAMES.flatMap((name, index): Fact[] => [
    ["SALE", `g-${index}`, "2026-11-07", null, name, "p-1", "A001", "สินค้า 1", 10 + index],
    ["SALE", `g-${index}-b`, "2026-11-08", null, name, `p-${10 + index}`, `B${index}`, `สินค้า ${10 + index}`, -index],
  ]),
  ...Array.from({ length: 14 }, (_, index): Fact =>
    ["SALE", `m-${index}`, "2026-11-09", `cust-m${index}`, `ลูกค้า M${index}`, `p-m${index}`, `M${index}`, `สินค้า M${index}`, 50 - index * 7]),
  ["PURCHASE_COST_VARIANCE", "dn-1", "2026-11-10", null, null, "p-1", "A001", "สินค้า 1", -25, true, "SUPPLIER_DN"],
  ["STOCK_VALUE_RESIDUAL", "p-2", "2026-11-11", null, null, "p-2", null, "สินค้า 2", -2, true, "RETURN_OUT"],
  ["EXPENSE", "e-1", "2026-11-12", null, null, null, null, null, -100],
  ["OTHER_INCOME", "o-1", "2026-11-12", null, null, null, null, null, 9],
  ["SALE", "s-x", "2026-11-12", "cust-1", "ลูกค้า A", "p-1", "A001", "สินค้า 1", 70, false],
  ["SALE", "s-old", "2026-10-31", "cust-1", "ลูกค้า A", "p-1", "A001", "สินค้า 1", 60],
  ["SALE", "s-next", "2026-12-01", "cust-2", "ลูกค้า B", "p-1", "A001", "สินค้า 1", 60],
];

let dashboard: typeof import("@/lib/profit-dashboard");
const RANGE = { from: "2026-11-01", to: "2026-11-30" };

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TYPE "ProfitSourceType" AS ENUM ('PURCHASE_COST_VARIANCE', 'SALE', 'SALE_RETURN', 'EXPENSE', 'STOCK_VALUE_RESIDUAL', 'OTHER_INCOME');
    CREATE TABLE "FactProfit" (
      "id" TEXT PRIMARY KEY, "businessDate" TIMESTAMPTZ(3) NOT NULL, "sourceType" "ProfitSourceType" NOT NULL,
      "sourceSubtype" TEXT, "sourceId" TEXT NOT NULL, "sourceDocNo" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL,
      "productId" TEXT, "productCode" TEXT, "productName" TEXT, "customerId" TEXT, "customerName" TEXT,
      "quantity" DECIMAL(12,4) NOT NULL, "salesAmountExVat" DECIMAL(10,2) NOT NULL, "salesAmountIncVat" DECIMAL(10,2) NOT NULL,
      "costAmount" DECIMAL(10,2) NOT NULL, "grossProfit" DECIMAL(10,2) NOT NULL, "unitCostPrice" DECIMAL(10,2) NOT NULL
    );
  `);
  for (const [index, fact] of FACTS.entries()) {
    const [sourceType, sourceId, day, customerId, customerName, productId, productCode, productName, gross,
      isActive = true, sourceSubtype = null] = fact;
    const sales = Math.max(gross, 0) * 2 + 1;
    await pg.query(`INSERT INTO "FactProfit" VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`, [
      `f-${index}`, `${day}T03:00:00Z`, sourceType, sourceSubtype, sourceId, sourceId.toUpperCase(), isActive,
      productId, productCode, productName, customerId, customerName, index % 3 + 1, sales, sales * 1.07, sales - gross, gross,
      (sales - gross) / (index % 3 + 1),
    ]);
  }
  await mock.module("next/cache", {
    namedExports: {
      unstable_cache: <Args extends unknown[], Result>(callback: (...args: Args) => Promise<Result>) => callback,
      revalidateTag: (): void => undefined,
    },
  });
  await mock.module("@/lib/db", { namedExports: { db, withDbRetry: <T>(operation: () => Promise<T>): Promise<T> => operation() } });
  dashboard = await import("@/lib/profit-dashboard");
});

after(async () => {
  await pg?.close();
});

const rangeWhere = (sourceTypes: string[]): Where => ({
  isActive: true,
  sourceType: { in: sourceTypes },
  businessDate: { gte: new Date("2026-10-31T17:00:00.000Z"), lte: new Date("2026-11-30T16:59:59.999Z") },
});
const PRODUCT_TYPES = ["SALE", "SALE_RETURN", "PURCHASE_COST_VARIANCE", "STOCK_VALUE_RESIDUAL"];
const CUSTOMER_TYPES = ["SALE", "SALE_RETURN"];

/** The previous page count: the number of groups the section's groupBy returned. */
async function previousGroupCount(by: string[], where: Where): Promise<number> {
  return (await emulatedGroupBy({ by, where })).length;
}

/** The previous bill counts: every (customerId, customerName, sourceId) group, counted per customer key. */
async function previousInvoiceCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const row of await emulatedGroupBy({ by: ["customerId", "customerName", "sourceId"], where: rangeWhere(CUSTOMER_TYPES) })) {
    const customerId = row.customerId as string | null;
    const customerName = row.customerName as string | null;
    const key = customerId ?? `guest:${customerName?.trim() || "ลูกค้าไม่ระบุ"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

test("product, customer and bill page counts equal the number of groups", { skip: moduleMocksUnavailable }, async () => {
  const productCount = await previousGroupCount(["productId", "productCode", "productName"],
    { ...rangeWhere(PRODUCT_TYPES), productId: { not: null }, productName: { not: null } });
  const customerCount = await previousGroupCount(["customerId", "customerName"], rangeWhere(CUSTOMER_TYPES));
  const invoiceCount = await previousGroupCount(
    ["sourceId", "sourceType", "sourceSubtype", "sourceDocNo", "businessDate", "customerName"], rangeWhere(PRODUCT_TYPES));
  assert.ok(productCount > 20 && customerCount > 20 && invoiceCount > 20, "several pages per section");

  for (const page of [1, 2, 3, 4]) {
    assert.equal((await dashboard.getProfitStockSection({ ...RANGE, page })).pagination.totalItems, productCount);
    assert.equal((await dashboard.getProfitCustomerSection({ ...RANGE, page })).pagination.totalItems, customerCount);
    assert.equal((await dashboard.getProfitInvoiceSection({ ...RANGE, page })).pagination.totalItems, invoiceCount);
  }
});

test("every customer row keeps its bill count on every page", { skip: moduleMocksUnavailable }, async () => {
  const previous = await previousInvoiceCounts();
  const seen: Array<[string, number]> = [];
  for (const page of [1, 2, 3, 4]) {
    const section = await dashboard.getProfitCustomerSection({ ...RANGE, page });
    for (const row of section.items) {
      const key = row.customerId ?? `guest:${row.customerName}`;
      assert.equal(row.invoiceCount, previous.get(key) ?? 0, `${key} on page ${page}`);
      seen.push([key, row.invoiceCount]);
    }
  }
  const counts = new Map(seen);
  // cust-1: (ลูกค้า A: s-1, s-2, s-3) + (ลูกค้า A (ใหม่): s-3, r-1) = 5 pairs.
  assert.equal(counts.get("cust-1"), 5);
  // "ร้าน ก", "ร้าน ก " and "  ร้าน ก" share one key; "ร้าน กข" is another guest.
  assert.equal(counts.get("guest:ร้าน ก"), 6);
  assert.equal(counts.get("guest:ร้าน กข"), 2);
  // null, "", "   ", U+3000, "ลูกค้าไม่ระบุ" and U+00A0 + "ลูกค้าไม่ระบุ" all trim to the unknown-customer key.
  assert.equal(counts.get("guest:ลูกค้าไม่ระบุ"), 12);
  assert.equal(counts.get("guest:ลูกค้าไม่ระบุ2"), 2);
  assert.equal(counts.get("guest:ร้าน ข"), 2);
});

test("an empty range reads no bill counts and returns empty pages", { skip: moduleMocksUnavailable }, async () => {
  const section = await dashboard.getProfitCustomerSection({ from: "2025-01-01", to: "2025-01-31", page: 1 });
  assert.deepEqual(section, { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } });
});
