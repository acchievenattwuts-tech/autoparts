import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Prisma } from "@/lib/generated/prisma";
import {
  PRODUCT_CARD_ALIAS_LIMIT,
  buildProductCardAliasesSql,
  groupProductCardAliases,
  type ProductCardAlias,
  type ProductCardAliasRow,
} from "../product-card-aliases";

/**
 * Golden check for the admin product search card aliases: the lateral query must return
 * exactly what the old nested `aliases: { orderBy: { id: "asc" }, take: 4 }` select did.
 * Prisma ran that as one `productId IN (...) ORDER BY id` query and kept the first `take`
 * rows of each product in memory (node_modules/@prisma/client/runtime/client.js), which
 * `oldPrismaNestedTake` reproduces against the same in-process Postgres.
 */

let pg: PGlite;

const run = async <T>(sql: Prisma.Sql): Promise<T[]> => {
  const result = await pg.query<T>(sql.text, sql.values);
  return result.rows;
};

const OLD_NESTED_TAKE = 4;

const oldPrismaNestedTake = async (productIds: string[]): Promise<Map<string, ProductCardAlias[]>> => {
  const result = await pg.query<ProductCardAliasRow>(
    `SELECT "productId", alias FROM "ProductAlias" WHERE "productId" = ANY($1::text[]) ORDER BY id ASC`,
    [productIds],
  );
  const grouped = new Map<string, ProductCardAlias[]>();
  for (const row of result.rows) {
    const list = grouped.get(row.productId) ?? [];
    list.push({ alias: row.alias });
    grouped.set(row.productId, list);
  }
  return new Map([...grouped].map(([id, list]) => [id, list.slice(0, OLD_NESTED_TAKE)]));
};

const newLateral = async (productIds: string[]): Promise<Map<string, ProductCardAlias[]>> =>
  groupProductCardAliases(await run<ProductCardAliasRow>(buildProductCardAliasesSql(productIds)));

/** What the card renders: `aliasesByProduct.get(id) ?? []` / `product.aliases`. */
const cardView = (map: Map<string, ProductCardAlias[]>, ids: string[]): Record<string, string[]> =>
  Object.fromEntries(ids.map((id) => [id, (map.get(id) ?? []).map((a) => a.alias)]));

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "Product" (id TEXT PRIMARY KEY);
    CREATE TABLE "ProductAlias" (id TEXT PRIMARY KEY, "productId" TEXT NOT NULL, alias TEXT NOT NULL);
    INSERT INTO "Product" VALUES ('pMany'), ('pFour'), ('pOne'), ('pNone'), ('pOther');
    -- inserted out of id order, ids of mixed length/case so ORDER BY id actually reorders them
    INSERT INTO "ProductAlias" VALUES
      ('cz9', 'pMany', 'Z-LAST'),
      ('ca1', 'pMany', 'ALPHA'),
      ('cb10', 'pMany', 'B10'),
      ('cb2', 'pMany', 'B2'),
      ('Cx', 'pMany', 'UPPER'),
      ('ca0', 'pMany', 'ZERO'),
      ('cm', 'pMany', 'MID'),
      ('d4', 'pFour', 'F4'),
      ('d1', 'pFour', 'F1'),
      ('d3', 'pFour', 'F3'),
      ('d2', 'pFour', 'F2'),
      ('e1', 'pOne', 'ONLY'),
      ('o1', 'pOther', 'NOT-ON-PAGE'),
      ('o2', 'pOther', 'NOT-ON-PAGE-2');
  `);
});

after(async () => {
  await pg?.close();
});

test("lateral query keeps the same 4 aliases in the same order as the nested take", async () => {
  const ids = ["pOne", "pMany", "pNone", "pFour", "missing-id"];
  const oldView = cardView(await oldPrismaNestedTake(ids), ids);
  const newView = cardView(await newLateral(ids), ids);
  assert.deepEqual(newView, oldView);
  assert.equal(newView.pMany.length, PRODUCT_CARD_ALIAS_LIMIT);
  assert.deepEqual(newView.pNone, []);
  assert.deepEqual(newView["missing-id"], []);
});

test("only products on the page are read", async () => {
  const rows = await run<ProductCardAliasRow>(buildProductCardAliasesSql(["pFour"]));
  assert.deepEqual(new Set(rows.map((row) => row.productId)), new Set(["pFour"]));
  assert.deepEqual(rows.map((row) => row.alias), ["F1", "F2", "F3", "F4"]);
});

test("every subset of the page gives the old result", async () => {
  const all = ["pMany", "pFour", "pOne", "pNone", "pOther"];
  for (let mask = 1; mask < 1 << all.length; mask += 1) {
    const ids = all.filter((_, index) => (mask & (1 << index)) !== 0);
    assert.deepEqual(cardView(await newLateral(ids), ids), cardView(await oldPrismaNestedTake(ids), ids));
  }
});

test("the SQL binds ids and limit as parameters", () => {
  const sql = buildProductCardAliasesSql(["a'; DROP TABLE x; --"]);
  assert.doesNotMatch(sql.text, /DROP TABLE/);
  assert.deepEqual(sql.values, [PRODUCT_CARD_ALIAS_LIMIT, ["a'; DROP TABLE x; --"]]);
});
