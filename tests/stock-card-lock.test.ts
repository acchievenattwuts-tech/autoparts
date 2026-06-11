import assert from "node:assert/strict";
import test from "node:test";
import { lockProductForStockMutation } from "../lib/stock-card";

test("lockProductForStockMutation takes a row-level Product lock", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve([]);
    },
  };

  await lockProductForStockMutation(tx, "product-1");

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT id FROM "Product" WHERE id = \? FOR UPDATE/);
  assert.deepEqual(calls[0].values, ["product-1"]);
});
