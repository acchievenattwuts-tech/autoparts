import assert from "node:assert/strict";
import test from "node:test";

import { applyShelfLocationChange, type ShelfLocationDraft, type ShelfRackRule } from "@/lib/shelf-location-rules";
import {
  buildShelfPrimaryOptions,
  describeShelfLocationRows,
  formatShelfPrimaryValue,
  isShelfPrimaryFieldChanged,
  isValidShelfPrimaryValue,
  parseShelfPrimaryValue,
  planProductFormShelfChanges,
  ShelfFormRuleError,
  toShelfFormLocations,
  type ShelfFormLocation,
} from "@/lib/shelf-product-form";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const A2 = { rackId: "ra1", level: 2 };
const B1 = { rackId: "rb1", level: 1 };
const HOME_A2 = { id: "loc1", ...A2 };

test("the hidden value round-trips rackId:level and rejects anything else", () => {
  assert.equal(formatShelfPrimaryValue(A2), "ra1:2");
  assert.deepEqual(parseShelfPrimaryValue("ra1:2"), A2);
  for (const bad of ["", null, undefined, "ra1", "ra1:0", "ra1:21", "RA1:2", "ra1:2:3", "ra 1:2", "ra1:-1", "a".repeat(51) + ":1"]) {
    assert.equal(parseShelfPrimaryValue(bad), null, String(bad));
  }
  assert.equal(isValidShelfPrimaryValue(""), true, "empty means no home");
  assert.equal(isValidShelfPrimaryValue("ra1:2"), true);
  assert.equal(isValidShelfPrimaryValue("A-2"), false, "the display code is not the submitted value");
});

test("an untouched field plans nothing, even if the home was moved meanwhile", () => {
  assert.equal(isShelfPrimaryFieldChanged(A2, { ...A2 }), false);
  assert.equal(isShelfPrimaryFieldChanged(null, null), false);
  assert.equal(isShelfPrimaryFieldChanged(B1, A2), true);
  assert.equal(isShelfPrimaryFieldChanged(null, A2), true);
  // Someone moved the home to B-1 from the shelf map while the form still showed A-2.
  assert.deepEqual(
    planProductFormShelfChanges({ current: { id: "loc9", ...B1 }, submitted: A2, original: A2, keepOldAsSecondary: false }),
    [],
  );
});

test("create or none -> set places the home", () => {
  assert.deepEqual(planProductFormShelfChanges({ current: null, submitted: A2, original: null, keepOldAsSecondary: false }), [
    { kind: "place", target: A2 },
  ]);
  assert.deepEqual(planProductFormShelfChanges({ current: null, submitted: null, original: null, keepOldAsSecondary: true }), []);
});

test("set -> different moves the home and carries the checkbox", () => {
  for (const keepOldAsSecondary of [false, true]) {
    assert.deepEqual(
      planProductFormShelfChanges({ current: HOME_A2, submitted: B1, original: A2, keepOldAsSecondary }),
      [{ kind: "movePrimary", target: B1, keepOldAsSecondary }],
    );
  }
});

test("set -> empty removes the current home by id", () => {
  assert.deepEqual(planProductFormShelfChanges({ current: HOME_A2, submitted: null, original: A2, keepOldAsSecondary: false }), [
    { kind: "remove", locationId: "loc1" },
  ]);
  // Already cleared elsewhere: nothing left to remove.
  assert.deepEqual(planProductFormShelfChanges({ current: null, submitted: null, original: A2, keepOldAsSecondary: false }), []);
});

test("a change to the value already stored is a no-op", () => {
  assert.deepEqual(planProductFormShelfChanges({ current: { id: "loc9", ...B1 }, submitted: B1, original: A2, keepOldAsSecondary: true }), []);
});

test("clearing the home with overflow locations promotes the newest one (rules, end to end)", () => {
  const racks: ShelfRackRule[] = [
    { id: "ra1", code: "A", levels: 4, isActive: true },
    { id: "rz1", code: "Z", levels: 2, isActive: true },
  ];
  const drafts: ShelfLocationDraft[] = [
    { id: "loc1", rackId: "ra1", level: 2, isPrimary: true, note: null, createdAt: minutesAgo(300), touched: false },
    { id: "loc2", rackId: "rz1", level: 1, isPrimary: false, note: null, createdAt: minutesAgo(200), touched: false },
    { id: "loc3", rackId: "rz1", level: 2, isPrimary: false, note: null, createdAt: minutesAgo(100), touched: false },
  ];
  const [change] = planProductFormShelfChanges({ current: HOME_A2, submitted: null, original: A2, keepOldAsSecondary: false });
  const result = applyShelfLocationChange(drafts, change, new Map(racks.map((rack) => [rack.id, rack])), NOW);
  assert.ok(result.ok);
  assert.deepEqual(
    result.locations.map((location) => [location.id, location.isPrimary]),
    [["loc2", false], ["loc3", true]],
  );
});

test("rule rejections carry their code for the Thai message", () => {
  const error = new ShelfFormRuleError("SECONDARY_LIMIT");
  assert.ok(error instanceof Error);
  assert.equal(error.ruleError, "SECONDARY_LIMIT");
});

const locations: ShelfFormLocation[] = [
  { id: "loc1", rackId: "ra1", level: 2, code: "A-2", isPrimary: true, note: null },
  { id: "loc2", rackId: "rz1", level: 1, code: "Z-1", isPrimary: false, note: "กล่องบน" },
];

test("options list every level of every rack after the empty choice, marking current locations", () => {
  const options = buildShelfPrimaryOptions(
    [
      { id: "ra1", code: "A", name: "ชั้นซ้าย", levels: 2 },
      { id: "rz1", code: "Z", name: null, levels: 1 },
    ],
    locations,
  );
  assert.deepEqual(options, [
    { id: "", label: "ยังไม่ระบุ" },
    { id: "ra1:1", label: "A-1", sublabel: "ชั้นซ้าย · ชั้น 1" },
    { id: "ra1:2", label: "A-2", sublabel: "ชั้นซ้าย · ชั้น 2 · ที่เก็บประจำตอนนี้" },
    { id: "rz1:1", label: "Z-1", sublabel: "ชั้น 1 · ที่เก็บเพิ่มตอนนี้" },
  ]);
});

test("a home on a rack that is no longer active stays selectable", () => {
  const options = buildShelfPrimaryOptions([{ id: "rz1", code: "Z", name: null, levels: 1 }], locations);
  assert.deepEqual(options.at(-1), { id: "ra1:2", label: "A-2", sublabel: "ชั้นวางนี้ปิดใช้งานหรือไม่มีชั้นนี้แล้ว" });
  assert.equal(options.filter((option) => option.id === "ra1:2").length, 1);
});

test("database rows become the sorted form list and the audit description", () => {
  const rows = [
    { id: "loc3", rackId: "rz1", level: 2, isPrimary: false, note: null, createdAt: minutesAgo(10), rack: { code: "Z" } },
    { id: "loc1", rackId: "ra1", level: 2, isPrimary: true, note: null, createdAt: minutesAgo(300), rack: { code: "A" } },
    { id: "loc2", rackId: "rz1", level: 1, isPrimary: false, note: "กล่องบน", createdAt: minutesAgo(200), rack: { code: "Z" } },
  ];
  assert.deepEqual(
    toShelfFormLocations(rows).map((location) => [location.code, location.isPrimary, location.note]),
    [["A-2", true, null], ["Z-2", false, null], ["Z-1", false, "กล่องบน"]],
  );
  assert.deepEqual(describeShelfLocationRows(rows), ["A-2 (ประจำ)", "Z-2 (เพิ่ม)", "Z-1 (เพิ่ม)"]);
  assert.deepEqual(describeShelfLocationRows([]), []);
});
