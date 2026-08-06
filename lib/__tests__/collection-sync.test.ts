import assert from "node:assert/strict";
import test from "node:test";
import { planCollectionSync } from "@/lib/collection-sync";

test("planCollectionSync keeps stable ids and isolates create/delete rows", () => {
  const plan = planCollectionSync({
    existing: [
      { id: "keep", key: "A", value: 1 },
      { id: "remove", key: "B", value: 2 },
    ],
    desired: [
      { key: "A", value: 3 },
      { key: "C", value: 4 },
    ],
    existingKey: (row) => row.key,
    desiredKey: (row) => row.key,
  });

  assert.deepEqual(plan.matched, [
    { existing: { id: "keep", key: "A", value: 1 }, desired: { key: "A", value: 3 } },
  ]);
  assert.deepEqual(plan.create, [{ key: "C", value: 4 }]);
  assert.deepEqual(plan.deleteIds, ["remove"]);
});

test("planCollectionSync treats duplicate keys as a multiset", () => {
  const plan = planCollectionSync({
    existing: [
      { id: "first", key: "same" },
      { id: "second", key: "same" },
    ],
    desired: [{ key: "same" }, { key: "same" }, { key: "same" }],
    existingKey: (row) => row.key,
    desiredKey: (row) => row.key,
  });

  assert.deepEqual(plan.matched.map(({ existing }) => existing.id), ["first", "second"]);
  assert.equal(plan.create.length, 1);
  assert.deepEqual(plan.deleteIds, []);
});
