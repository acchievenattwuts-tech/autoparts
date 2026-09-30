import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, PrismaClient } from "@/lib/generated/prisma";

// E7 / ก5 deploy window: the code that treats SaleItem.quantity and PurchaseItem.quantity as
// Decimal(12,4) ships BEFORE prisma/migrations/20260930_sale_item_quantity_decimal and
// 20260930_purchase_item_quantity_decimal run, so for a while the generated client talks to
// the old int4 columns. This drives the real generated client (query compiler
// + result mapper) through an in-memory driver adapter that answers exactly like
// @prisma/adapter-pg does for an int4 column (column type Int32, JS number value). No network
// or database is touched.

type AdapterFactory = NonNullable<Prisma.PrismaClientOptions["adapter"]>;
type SqlDriverAdapter = Awaited<ReturnType<AdapterFactory["connect"]>>;
type SqlQuery = Parameters<SqlDriverAdapter["queryRaw"]>[0];
type SqlResultSet = Awaited<ReturnType<SqlDriverAdapter["queryRaw"]>>;

// @prisma/driver-adapter-utils ColumnTypeEnum values (what adapter-pg reports for text / int4).
const COLUMN_TYPE_INT32 = 0;
const COLUMN_TYPE_TEXT = 7;

function createInt4Adapter(queries: SqlQuery[]): AdapterFactory {
  const int4Row: SqlResultSet = {
    columnNames: ["id", "quantity"],
    columnTypes: [COLUMN_TYPE_TEXT, COLUMN_TYPE_INT32],
    rows: [["item-1", 3]],
  };
  const queryable = {
    provider: "postgres" as const,
    adapterName: "int4-window-fake",
    queryRaw: async (query: SqlQuery): Promise<SqlResultSet> => {
      queries.push(query);
      return int4Row;
    },
    executeRaw: async (query: SqlQuery): Promise<number> => {
      queries.push(query);
      return 1;
    },
  };
  const adapter: SqlDriverAdapter = {
    ...queryable,
    executeScript: async () => undefined,
    startTransaction: async () => ({
      ...queryable,
      options: { usePhantomQuery: false },
      commit: async () => undefined,
      rollback: async () => undefined,
    }),
    dispose: async () => undefined,
  };
  return { provider: "postgres", adapterName: "int4-window-fake", connect: async () => adapter };
}

test("SaleItem: an int4 quantity is read into the Decimal field and converts back to the same integer", async () => {
  const queries: SqlQuery[] = [];
  const client = new PrismaClient({ adapter: createInt4Adapter(queries) });
  try {
    const row = await client.saleItem.findFirst({ select: { id: true, quantity: true } });
    assert.ok(row);
    assert.ok(Prisma.Decimal.isDecimal(row.quantity), "Prisma wraps the int4 value in a Decimal");
    assert.equal(Number(row.quantity), 3);
    assert.equal(row.quantity.toString(), "3");
    assert.match(queries[0]?.sql ?? "", /"SaleItem"\."quantity"/);
  } finally {
    await client.$disconnect();
  }
});

test("SaleItem: an integer quantity is written as the plain text int4 accepts; a fraction needs the migrated column", async () => {
  const queries: SqlQuery[] = [];
  const client = new PrismaClient({ adapter: createInt4Adapter(queries) });
  const data = { saleId: "sale-1", productId: "oil-1", salePrice: 200, costPrice: 150, totalAmount: 600 };
  try {
    await client.saleItem.create({ data: { ...data, quantity: 3 }, select: { id: true } });
    await client.saleItem.create({ data: { ...data, quantity: 0.4 }, select: { id: true } });
  } finally {
    await client.$disconnect();
  }
  const quantityArgs = queries
    .filter((query) => /INSERT INTO "public"\."SaleItem"/.test(query.sql))
    .map((query) => {
      const columns = /\(([^)]*)\) VALUES/.exec(query.sql)?.[1].split(",") ?? [];
      return query.args[columns.indexOf('"quantity"')];
    });
  // No SQL cast is emitted: PostgreSQL types the parameter from the target column. Against
  // int4, "3" is stored exactly as the Int field stored it; "0.4" is rejected with an error
  // (never silently rounded), so fractional sales must wait for the migration.
  assert.deepEqual(quantityArgs, ["3", "0.4"]);
});

test("PurchaseItem: an int4 quantity reads into the Decimal field; writes send plain text with no cast", async () => {
  const queries: SqlQuery[] = [];
  const client = new PrismaClient({ adapter: createInt4Adapter(queries) });
  const data = { purchaseId: "purchase-1", productId: "oil-1", costPrice: 150, totalAmount: 3075 };
  try {
    const row = await client.purchaseItem.findFirst({ select: { id: true, quantity: true } });
    assert.ok(row);
    assert.ok(Prisma.Decimal.isDecimal(row.quantity));
    assert.equal(Number(row.quantity), 3);
    await client.purchaseItem.create({ data: { ...data, quantity: 3 }, select: { id: true } });
    await client.purchaseItem.create({ data: { ...data, quantity: 20.5 }, select: { id: true } });
  } finally {
    await client.$disconnect();
  }
  const quantityArgs = queries
    .filter((query) => /INSERT INTO "public"\."PurchaseItem"/.test(query.sql))
    .map((query) => {
      const columns = /\(([^)]*)\) VALUES/.exec(query.sql)?.[1].split(",") ?? [];
      return query.args[columns.indexOf('"quantity"')];
    });
  assert.deepEqual(quantityArgs, ["3", "20.5"]);
});
