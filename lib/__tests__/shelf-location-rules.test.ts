import assert from "node:assert/strict";
import test from "node:test";

import {
  applyShelfLocationChange,
  describeShelfLocations,
  diffShelfLocations,
  formatShelfLocationCode,
  isVerifyOnlyShelfDiff,
  MAX_SECONDARY_SHELF_LOCATIONS,
  parseShelfLocationCode,
  type ShelfLocationChange,
  type ShelfLocationDraft,
  type ShelfRackRule,
} from "@/lib/shelf-location-rules";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const racks: ShelfRackRule[] = [
  { id: "rA", code: "A", levels: 4, isActive: true },
  { id: "rB", code: "B", levels: 3, isActive: true },
  { id: "rP", code: "P", levels: 1, isActive: true },
  { id: "rZ", code: "Z", levels: 2, isActive: true },
  { id: "rX", code: "X", levels: 2, isActive: false },
];
const racksById = new Map(racks.map((rack) => [rack.id, rack]));

const at = (id: string, rackId: string, level: number, isPrimary: boolean, minutesAgo = 60): ShelfLocationDraft => ({
  id,
  rackId,
  level,
  isPrimary,
  note: null,
  createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  touched: false,
});

const run = (locations: ShelfLocationDraft[], ...changes: ShelfLocationChange[]) => {
  let current = locations;
  for (const change of changes) {
    const result = applyShelfLocationChange(current, change, racksById, NOW);
    if (!result.ok) return result;
    current = result.locations;
  }
  return { ok: true as const, locations: current };
};

const codes = (locations: ShelfLocationDraft[]): string[] => describeShelfLocations(locations, racksById);

test("location codes format and parse", () => {
  assert.equal(formatShelfLocationCode("A", 2), "A-2");
  assert.deepEqual(parseShelfLocationCode(" a - 2 "), { rackCode: "A", level: 2 });
  assert.equal(parseShelfLocationCode("A-0"), null);
  assert.equal(parseShelfLocationCode("A2"), null);
});

test("1: the first location placed becomes the home", () => {
  const result = run([], { kind: "place", target: { rackId: "rA", level: 2 } });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["A-2 (ประจำ)"]);
});

test("2: keeping it at home only confirms the existing row", () => {
  const before = [at("l1", "rA", 2, true)];
  const result = run(before, { kind: "confirm", locationId: "l1" });
  assert.ok(result.ok);
  const diff = diffShelfLocations(before, result.locations);
  assert.deepEqual(diff, { deleteIds: [], creates: [], updates: [{ id: "l1", verify: true }] });
  assert.equal(isVerifyOnlyShelfDiff(diff), true);
});

test("3: overflow adds a secondary and leaves the home alone", () => {
  const before = [at("l1", "rB", 1, true)];
  const result = run(before, { kind: "addSecondary", target: { rackId: "rP", level: 1 } });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["B-1 (ประจำ)", "P-1 (เพิ่ม)"]);
  const diff = diffShelfLocations(before, result.locations);
  assert.deepEqual(diff.creates, [{ rackId: "rP", level: 1, isPrimary: false, note: null }]);
  assert.equal(isVerifyOnlyShelfDiff(diff), false);
});

test("placing a product where it already is confirms instead of duplicating", () => {
  const before = [at("l1", "rB", 1, true), at("l2", "rP", 1, false)];
  const result = run(before, { kind: "place", target: { rackId: "rP", level: 1 } });
  assert.ok(result.ok);
  assert.deepEqual(diffShelfLocations(before, result.locations).updates, [{ id: "l2", verify: true }]);
});

test("4: removing a secondary deletes only that row", () => {
  const before = [at("l1", "rB", 1, true), at("l2", "rP", 1, false)];
  const result = run(before, { kind: "remove", locationId: "l2" });
  assert.ok(result.ok);
  assert.deepEqual(diffShelfLocations(before, result.locations), { deleteIds: ["l2"], creates: [], updates: [] });
});

test("7a: moving the home with nothing left behind removes the old home", () => {
  const before = [at("l1", "rA", 3, true)];
  const result = run(before, { kind: "movePrimary", target: { rackId: "rB", level: 2 }, keepOldAsSecondary: false });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["B-2 (ประจำ)"]);
  assert.deepEqual(diffShelfLocations(before, result.locations).deleteIds, ["l1"]);
});

test("7b: moving the home with stock left behind keeps the old home as a secondary", () => {
  const before = [at("l1", "rA", 3, true)];
  const result = run(before, { kind: "movePrimary", target: { rackId: "rB", level: 2 }, keepOldAsSecondary: true });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["B-2 (ประจำ)", "A-3 (เพิ่ม)"]);
});

test("8: promoting a secondary swaps it with the home", () => {
  const before = [at("l1", "rA", 1, true), at("l2", "rZ", 1, false)];
  const result = run(before, { kind: "promote", locationId: "l2" });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["Z-1 (ประจำ)", "A-1 (เพิ่ม)"]);
  const diff = diffShelfLocations(before, result.locations);
  assert.deepEqual(diff.updates, [
    { id: "l1", verify: false, isPrimary: false },
    { id: "l2", verify: true, isPrimary: true },
  ]);
});

test("9: removing the home promotes the newest secondary", () => {
  const before = [at("l1", "rA", 1, true, 300), at("l2", "rZ", 1, false, 200), at("l3", "rZ", 2, false, 10)];
  const result = run(before, { kind: "remove", locationId: "l1" });
  assert.ok(result.ok);
  assert.deepEqual(codes(result.locations), ["Z-2 (ประจำ)", "Z-1 (เพิ่ม)"]);
});

test("9b: removing the only location leaves the product without a home", () => {
  const result = run([at("l1", "rA", 1, true)], { kind: "remove", locationId: "l1" });
  assert.ok(result.ok);
  assert.deepEqual(result.locations, []);
});

test("secondaries are capped", () => {
  const before = [
    at("l1", "rA", 1, true),
    at("l2", "rA", 2, false),
    at("l3", "rA", 3, false),
    at("l4", "rA", 4, false),
  ];
  assert.equal(MAX_SECONDARY_SHELF_LOCATIONS, 3);
  const result = run(before, { kind: "addSecondary", target: { rackId: "rB", level: 1 } });
  assert.deepEqual(result, { ok: false, error: "SECONDARY_LIMIT" });
  const keepOld = run(before, { kind: "movePrimary", target: { rackId: "rB", level: 1 }, keepOldAsSecondary: true });
  assert.deepEqual(keepOld, { ok: false, error: "SECONDARY_LIMIT" });
});

test("targets must be an active rack and an existing level", () => {
  assert.deepEqual(run([], { kind: "place", target: { rackId: "nope", level: 1 } }), { ok: false, error: "RACK_NOT_FOUND" });
  assert.deepEqual(run([], { kind: "place", target: { rackId: "rX", level: 1 } }), { ok: false, error: "RACK_INACTIVE" });
  assert.deepEqual(run([], { kind: "place", target: { rackId: "rB", level: 4 } }), { ok: false, error: "LEVEL_OUT_OF_RANGE" });
  assert.deepEqual(run([], { kind: "confirm", locationId: "gone" }), { ok: false, error: "LOCATION_NOT_FOUND" });
});

test("relocating a row keeps its type; relocating onto an existing row merges them", () => {
  const before = [at("l1", "rA", 1, true), at("l2", "rZ", 1, false)];
  const moved = run(before, { kind: "relocate", locationId: "l2", target: { rackId: "rZ", level: 2 } });
  assert.ok(moved.ok);
  assert.deepEqual(codes(moved.locations), ["A-1 (ประจำ)", "Z-2 (เพิ่ม)"]);
  assert.deepEqual(diffShelfLocations(before, moved.locations).updates, [
    { id: "l2", verify: true, rackId: "rZ", level: 2 },
  ]);

  const merged = run(before, { kind: "relocate", locationId: "l1", target: { rackId: "rZ", level: 1 } });
  assert.ok(merged.ok);
  assert.deepEqual(codes(merged.locations), ["Z-1 (ประจำ)"]);
  assert.deepEqual(diffShelfLocations(before, merged.locations).deleteIds, ["l1"]);
});

test("notes are trimmed, cleared when blank and length-checked", () => {
  const before = [at("l1", "rA", 1, true)];
  const noted = run(before, { kind: "setNote", locationId: "l1", note: "  กล่องฟ้า ซ้ายสุด " });
  assert.ok(noted.ok);
  assert.equal(noted.locations[0].note, "กล่องฟ้า ซ้ายสุด");
  const cleared = run(noted.locations, { kind: "setNote", locationId: "l1", note: "   " });
  assert.ok(cleared.ok);
  assert.equal(cleared.locations[0].note, null);
  assert.deepEqual(run(before, { kind: "setNote", locationId: "l1", note: "x".repeat(101) }), {
    ok: false,
    error: "NOTE_TOO_LONG",
  });
});

test("the input array is never mutated", () => {
  const before = [at("l1", "rA", 1, true), at("l2", "rZ", 1, false)];
  const snapshot = JSON.stringify(before);
  run(before, { kind: "promote", locationId: "l2" }, { kind: "remove", locationId: "l1" });
  assert.equal(JSON.stringify(before), snapshot);
});
