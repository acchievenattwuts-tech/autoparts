import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createRowKey,
  createRowRequestTracker,
  omitRowState,
  seedRowKeys,
  stripRowKeys,
} from "@/lib/form-row-state";

// Bug: PurchaseReturnForm kept per-row lot state (availableLots / lotsLoading) keyed
// by row index and rendered rows with key={i}. Removing a middle row slid the next
// row into the removed row's index, so it showed (and could pick from) the removed
// row's lots, and a late lot response could land on whichever row now sat at that
// index. Rows now carry a stable client-only rowKey.

const FORM_PATH = "app/admin/(protected)/purchase-returns/new/PurchaseReturnForm.tsx";

test("removing a middle row keeps every remaining row on its own lots", () => {
  const { rows, state } = seedRowKeys(
    [{ productId: "A" }, { productId: "B" }, { productId: "C" }],
    "pr-row",
    { 0: ["A-lot"], 1: ["B-lot"], 2: ["C-lot"] },
  );
  const removed = rows[1].rowKey;
  const remaining = rows.filter((row) => row.rowKey !== removed);
  const lots = omitRowState(state, removed);

  assert.deepEqual(
    remaining.map((row) => [row.productId, lots[row.rowKey]]),
    [["A", ["A-lot"]], ["C", ["C-lot"]]],
  );
});

test("seedRowKeys gives each seeded row a unique key and re-keys index-based state", () => {
  const { rows, state } = seedRowKeys([{ productId: "A" }, { productId: "B" }], "pr-row", { 1: ["B-lot"] });
  assert.notEqual(rows[0].rowKey, rows[1].rowKey);
  assert.deepEqual(state, { [rows[1].rowKey]: ["B-lot"] });
  assert.deepEqual(seedRowKeys([{ productId: "A" }], "pr-row").state, {});
});

test("the submitted items are identical to the form rows without rowKey", () => {
  const rowKey = createRowKey("pr-row");
  const items = [
    {
      rowKey,
      productId: "p1",
      unitName: "ชิ้น",
      qty: 2,
      moreDetail: "",
      lotItems: [{ lotNo: "L1", qty: 2, unitCost: 10, mfgDate: "", expDate: "" }],
    },
  ];
  const payload = stripRowKeys(items);
  const { rowKey: omitted, ...expected } = items[0];
  void omitted;
  assert.deepEqual(payload, [expected]);
  assert.equal(JSON.stringify(payload).includes("rowKey"), false);
  assert.equal(items[0].rowKey, rowKey, "form state is not mutated");
});

test("a late lot response for a removed or re-requested row is dropped", () => {
  const tracker = createRowRequestTracker();
  const first = tracker.begin("row-b");
  const second = tracker.begin("row-b");
  assert.equal(tracker.isCurrent("row-b", first), false);
  tracker.forget("row-b");
  assert.equal(tracker.isCurrent("row-b", second), false);
});

test("PurchaseReturnForm keys rows and per-row lot state by rowKey, not index", () => {
  const source = readFileSync(join(process.cwd(), FORM_PATH), "utf8");
  assert.doesNotMatch(source, /Record<number, boolean>/);
  assert.doesNotMatch(source, /useState<Record<number,/);
  assert.doesNotMatch(source, /key=\{i\}/);
  assert.match(source, /<Fragment key=\{item\.rowKey\}>/);
  assert.doesNotMatch(source, /(availableLots|lotsLoading)\[(i|itemIdx|itemIndex)\]/);
  assert.match(source, /formData\.set\("items", JSON\.stringify\(stripRowKeys\(items\)\)\)/);
  // Async lot results are only applied while the request is still current.
  assert.match(source, /lotRequests\.current\.isCurrent\(rowKey, token\)/);
  // Removing a row drops its lot state and any request in flight.
  assert.match(source, /const removeItem = \(rowKey: string\) => \{[\s\S]*?clearRowLots\(rowKey\);/);
});
