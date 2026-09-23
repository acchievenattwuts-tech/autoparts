import test from "node:test";
import assert from "node:assert/strict";

import { shiftRowIndexCacheAfterRemoval } from "../row-index-cache";

test("removing a middle row drops its entry and shifts later rows down", () => {
  const cache = { 0: ["A-lot"], 1: ["B-lot"], 2: ["C-lot"] };
  assert.deepEqual(shiftRowIndexCacheAfterRemoval(cache, 1), { 0: ["A-lot"], 1: ["C-lot"] });
});

test("removing the first row moves the next row's lots to index 0", () => {
  const cache = { 0: ["A-lot"], 1: ["B-lot"] };
  assert.deepEqual(shiftRowIndexCacheAfterRemoval(cache, 0), { 0: ["B-lot"] });
});

test("sparse caches keep gaps and earlier rows are untouched", () => {
  const cache: Record<number, boolean> = { 0: true, 3: false, 5: true };
  assert.deepEqual(shiftRowIndexCacheAfterRemoval(cache, 2), { 0: true, 2: false, 4: true });
});

test("removing a row without a cache entry still shifts later rows", () => {
  const cache = { 2: "x" };
  assert.deepEqual(shiftRowIndexCacheAfterRemoval(cache, 0), { 1: "x" });
});

test("does not mutate the input", () => {
  const cache = { 0: "a", 1: "b" };
  shiftRowIndexCacheAfterRemoval(cache, 0);
  assert.deepEqual(cache, { 0: "a", 1: "b" });
});
