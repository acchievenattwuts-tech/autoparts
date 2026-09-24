import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createRowRequestTracker, omitRowState } from "@/lib/form-row-state";
import { mergeClaimLockedItems } from "../sale-form-data";
import {
  createSaleRowKey,
  rekeyRestoredSaleRows,
  seedSaleRows,
  stripSaleRowKeys,
} from "../sale-row-state";

// SaleForm per-row lot state used to be keyed by row index and async lot results
// were written by index, so a late response could land on the row that slid into
// a removed row's index. Rows now carry a stable client-only rowKey.

type TestLine = {
  productId: string;
  unitName: string;
  qty: number;
  salePrice: number;
  unitListPrice: number;
  lineDiscount: number;
  warrantyDays: number;
  supplierId: string;
  supplierName: string;
  moreDetail: string;
  lotItems: { lotNo: string; qty: number }[];
  claimLock?: { claimNos: string[]; reason: string };
};

const line = (productId: string, extra: Partial<TestLine> = {}): TestLine => ({
  productId,
  unitName: "ชิ้น",
  qty: 1,
  salePrice: 100,
  unitListPrice: 100,
  lineDiscount: 0,
  warrantyDays: 0,
  supplierId: "",
  supplierName: "",
  moreDetail: "",
  lotItems: [],
  ...extra,
});

test("row keys are unique per created row", () => {
  const keys = new Set(Array.from({ length: 50 }, () => createSaleRowKey()));
  assert.equal(keys.size, 50);
});

test("seeded rows get fresh keys and the edit page's index-keyed lot options follow them", () => {
  const { rows, state } = seedSaleRows([line("p1"), line("p2"), line("p3")], {
    0: ["A-lot"],
    2: ["C-lot"],
  });
  assert.equal(new Set(rows.map((row) => row.rowKey)).size, 3);
  assert.deepEqual(rows.map((row) => state[row.rowKey]), [["A-lot"], undefined, ["C-lot"]]);
});

test("removing a middle row keeps every remaining row on its own lots", () => {
  const { rows: seeded, state } = seedSaleRows([line("p1"), line("p2"), line("p3")], {
    0: ["A-lot"],
    1: ["B-lot"],
    2: ["C-lot"],
  });
  const removed = seeded[1].rowKey;
  const rows = seeded.filter((row) => row.rowKey !== removed);
  const lots = omitRowState(state, removed);
  assert.deepEqual(rows.map((row) => lots[row.rowKey]), [["A-lot"], ["C-lot"]]);
});

test("a late lot response for a removed row, or a row whose product changed, is dropped", () => {
  const tracker = createRowRequestTracker();
  const [a, b] = [createSaleRowKey(), createSaleRowKey()];

  const forA = tracker.begin(a);
  const forB = tracker.begin(b);
  tracker.forget(a); // row A removed while its request was in flight
  assert.equal(tracker.isCurrent(a, forA), false);
  assert.equal(tracker.isCurrent(b, forB), true, "the other row is unaffected");

  const first = tracker.begin(b);
  const second = tracker.begin(b); // product changed and lots re-requested
  assert.equal(tracker.isCurrent(b, first), false);
  assert.equal(tracker.isCurrent(b, second), true);
});

test("the submitted items are byte-identical to the rows without their rowKey", () => {
  const withoutKey = [line("p1", { lotItems: [{ lotNo: "L-01", qty: 1 }] }), line("p2")];
  const { rows } = seedSaleRows(withoutKey);
  const payload = JSON.stringify(stripSaleRowKeys(rows));
  assert.equal(payload, JSON.stringify(withoutKey));
  assert.equal(payload.includes("rowKey"), false);
  assert.ok(rows.every((row) => typeof row.rowKey === "string"), "form state keeps its keys");
});

test("a restored draft keeps the key (and lots) of a row only when it lands on the same product", () => {
  const { rows: current } = seedSaleRows([line("p1"), line("p2"), line("p3")]);
  const restored = rekeyRestoredSaleRows(current, [line("p1"), line("p9"), line("")]);

  assert.equal(restored.rows[0].rowKey, current[0].rowKey, "same product at the same position");
  assert.notEqual(restored.rows[1].rowKey, current[1].rowKey, "different product gets a fresh key");
  assert.notEqual(restored.rows[2].rowKey, current[2].rowKey, "an empty row never inherits lots");
  assert.deepEqual(restored.droppedKeys, [current[1].rowKey, current[2].rowKey]);
  assert.equal(new Set(restored.rows.map((row) => row.rowKey)).size, 3);
  assert.equal(JSON.stringify(stripSaleRowKeys(restored.rows)), JSON.stringify([line("p1"), line("p9"), line("")]));
});

test("restoring a draft on a claim-locked sale keeps the server copy of the locked lines", () => {
  const lockedServer = line("p-locked", { claimLock: { claimNos: ["WC26090001"], reason: "x" } });
  const draftItems = [line("p-locked", { qty: 5, claimLock: { claimNos: ["WC26090001"], reason: "x" } }), line("p-free")];
  const { rows: current } = seedSaleRows([lockedServer, line("p-other")]);

  const restored = rekeyRestoredSaleRows(current, mergeClaimLockedItems(draftItems, [lockedServer]));

  assert.deepEqual(stripSaleRowKeys(restored.rows), [lockedServer, line("p-free")]);
  assert.equal(restored.rows[0].rowKey, current[0].rowKey);
  assert.deepEqual(restored.droppedKeys, [current[1].rowKey]);
});

test("SaleForm keys rows and async lot results by rowKey, and strips it from payload and draft", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/sales/new/SaleForm.tsx"), "utf8");
  assert.doesNotMatch(source, /key=\{i\}/);
  assert.doesNotMatch(source, /shiftRowIndexCacheAfterRemoval/);
  assert.match(source, /formData\.set\("items", JSON\.stringify\(stripSaleRowKeys\(items\)\)\)/);
  assert.equal(source.match(/items: stripSaleRowKeys\(items\)/g)?.length, 2, "draft snapshot and saved draft");
  assert.match(source, /lotRequests\.current\.isCurrent\(rowKey, token\)/);
});
