import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueById } from "../RelatedProductsSection";

test("load-more never appends a product that is already shown", () => {
  const current = [{ id: "a" }, { id: "b" }];
  const next = [{ id: "b" }, { id: "c" }, { id: "c" }];
  assert.deepEqual(appendUniqueById(current, next), [{ id: "a" }, { id: "b" }, { id: "c" }]);
});

test("a page of only duplicates leaves the list untouched", () => {
  const current = [{ id: "a" }];
  assert.equal(appendUniqueById(current, [{ id: "a" }]), current);
});
