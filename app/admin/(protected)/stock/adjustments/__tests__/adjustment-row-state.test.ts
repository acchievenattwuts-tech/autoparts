import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createAdjustmentRowKey,
  createRowRequestTracker,
  omitRowState,
  stripAdjustmentRowKeys,
} from "../adjustment-row-state";

// Bug: per-row lot state was keyed by row index, so removing a middle row let the
// next row pick up the removed row's lots. It is now keyed by a stable rowKey.

test("row keys are unique per created row", () => {
  const keys = new Set(Array.from({ length: 50 }, () => createAdjustmentRowKey()));
  assert.equal(keys.size, 50);
});

test("removing a middle row keeps every remaining row on its own lots", () => {
  const [a, b, c] = [createAdjustmentRowKey(), createAdjustmentRowKey(), createAdjustmentRowKey()];
  let rows = [{ rowKey: a }, { rowKey: b }, { rowKey: c }];
  let lots: Record<string, string[]> = { [a]: ["A-lot"], [b]: ["B-lot"], [c]: ["C-lot"] };

  rows = rows.filter((row) => row.rowKey !== b);
  lots = omitRowState(lots, b);

  assert.deepEqual(rows.map((row) => lots[row.rowKey]), [["A-lot"], ["C-lot"]]);
  assert.equal(b in lots, false);
});

test("omitRowState returns the same object when the row has no entry", () => {
  const state = { k1: true };
  assert.equal(omitRowState(state, "missing"), state);
  assert.deepEqual(omitRowState(state, "k1"), {});
  assert.deepEqual(state, { k1: true }, "input is not mutated");
});

test("stripAdjustmentRowKeys removes only the client key from the server payload", () => {
  const items = [{ rowKey: "adj-row-1", productId: "p1", qty: 2, lotItems: [] }];
  const payload = stripAdjustmentRowKeys(items);
  assert.deepEqual(payload, [{ productId: "p1", qty: 2, lotItems: [] }]);
  assert.equal(JSON.stringify(payload).includes("rowKey"), false);
  assert.equal(items[0].rowKey, "adj-row-1", "form state is not mutated");
});

test("a late lot response is dropped when the row was removed, changed, or re-requested", () => {
  const tracker = createRowRequestTracker();

  const first = tracker.begin("r1");
  assert.equal(tracker.isCurrent("r1", first), true);

  // A newer request for the same row (e.g. product A -> product B) wins.
  const second = tracker.begin("r1");
  assert.equal(tracker.isCurrent("r1", first), false);
  assert.equal(tracker.isCurrent("r1", second), true);

  // Row removed, or product/type changed without a new request.
  tracker.forget("r1");
  assert.equal(tracker.isCurrent("r1", second), false);

  // Other rows are unaffected until the whole list is replaced.
  const other = tracker.begin("r2");
  const kept = tracker.begin("r3");
  tracker.forget("r2");
  assert.equal(tracker.isCurrent("r2", other), false);
  assert.equal(tracker.isCurrent("r3", kept), true);
  tracker.reset();
  assert.equal(tracker.isCurrent("r3", kept), false);
});

test("AdjustmentForm keys rows and per-row lot state by rowKey, not index", () => {
  const source = readFileSync(
    join(process.cwd(), "app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /Record<number,/);
  assert.match(source, /key=\{item\.rowKey\}/);
  assert.doesNotMatch(source, /(availableLots|lotsLoading)\[(i|itemIdx)\]/);
  assert.match(source, /formData\.set\("items", JSON\.stringify\(stripAdjustmentRowKeys\(items\)\)\)/);
  // Async lot results are only applied while the request is still current.
  assert.match(source, /lotRequests\.current\.isCurrent\(rowKey, token\)/);
});
