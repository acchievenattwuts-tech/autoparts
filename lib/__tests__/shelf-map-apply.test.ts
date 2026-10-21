import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@/lib/generated/prisma";
import { applyShelfLocationDiffs, changeManyProductShelfLocations } from "@/lib/shelf-map";
import {
  applyShelfLocationChange,
  diffShelfLocations,
  type ShelfLocationDraft,
  type ShelfRackRule,
} from "@/lib/shelf-location-rules";

type Row = { id: string; productId: string; rackId: string; level: number; isPrimary: boolean; note: string | null };
type IdFilter = { where: { id: { in: string[] } } };

/**
 * In-memory ProductShelfLocation that enforces both unique indexes after every statement,
 * like Postgres does, so a bad statement order fails the test.
 */
const createFakeTx = (rows: Row[], racks: ShelfRackRule[] = []) => {
  const table = new Map(rows.map((row) => [row.id, { ...row }]));
  let nextId = 1;
  const shelfRack = { findMany: async () => racks.map((rack) => ({ ...rack })) };
  const assertUnique = (): void => {
    const positions = new Set<string>();
    const primaries = new Set<string>();
    for (const row of table.values()) {
      const position = `${row.productId}|${row.rackId}|${row.level}`;
      if (positions.has(position)) throw new Error(`unique (productId, rackId, level) violated at ${position}`);
      positions.add(position);
      if (row.isPrimary) {
        if (primaries.has(row.productId)) throw new Error(`one primary per product violated for ${row.productId}`);
        primaries.add(row.productId);
      }
    }
  };
  const productShelfLocation = {
    findMany: async ({ where }: { where: { productId: { in: string[] } } }) =>
      [...table.values()]
        .filter((row) => where.productId.in.includes(row.productId))
        .map((row) => ({ ...row, createdAt: new Date("2026-10-01T00:00:00.000Z") })),
    deleteMany: async ({ where }: IdFilter) => {
      for (const id of where.id.in) table.delete(id);
      assertUnique();
    },
    updateMany: async ({ where, data }: IdFilter & { data: Partial<Row> & { verifiedAt?: Date } }) => {
      for (const id of where.id.in) {
        const row = table.get(id);
        if (row) Object.assign(row, { ...data, verifiedAt: undefined });
      }
      assertUnique();
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = table.get(where.id);
      if (!row) throw new Error(`row ${where.id} not found`);
      Object.assign(row, data);
      assertUnique();
      return { id: row.id };
    },
    createMany: async ({ data }: { data: Array<Omit<Row, "id"> & { verifiedAt?: Date }> }) => {
      for (const item of data) {
        const id = `new${nextId++}`;
        table.set(id, { id, productId: item.productId, rackId: item.rackId, level: item.level, isPrimary: item.isPrimary, note: item.note });
      }
      assertUnique();
    },
  };
  return { tx: { productShelfLocation, shelfRack } as unknown as Prisma.TransactionClient, table };
};

const NOW = new Date("2026-10-19T03:00:00.000Z");
const racksById = new Map<string, ShelfRackRule>([
  ["rA", { id: "rA", code: "A", levels: 4, isActive: true }],
  ["rB", { id: "rB", code: "B", levels: 4, isActive: true }],
  ["rZ", { id: "rZ", code: "Z", levels: 2, isActive: true }],
]);
const draft = (row: Row): ShelfLocationDraft => ({ ...row, createdAt: NOW, touched: false });

test("chained relocations of one product never collide, in either row order", async () => {
  for (const order of [["z1", "a2"], ["a2", "z1"]] as const) {
    const rows: Row[] = [
      { id: "a2", productId: "p1", rackId: "rA", level: 2, isPrimary: true, note: null },
      { id: "z1", productId: "p1", rackId: "rZ", level: 1, isPrimary: false, note: null },
    ];
    // Z-1 -> B-2, then A-2 -> Z-1 (the second move lands where the first row was).
    let locations = rows.map(draft);
    for (const change of [
      { kind: "relocate" as const, locationId: "z1", target: { rackId: "rB", level: 2 } },
      { kind: "relocate" as const, locationId: "a2", target: { rackId: "rZ", level: 1 } },
    ]) {
      const result = applyShelfLocationChange(locations, change, racksById, NOW);
      assert.ok(result.ok);
      locations = result.locations;
    }
    const diff = diffShelfLocations(rows.map(draft), locations);
    diff.updates.sort((a, b) => order.indexOf(a.id as "z1" | "a2") - order.indexOf(b.id as "z1" | "a2"));

    const { tx, table } = createFakeTx(rows);
    await applyShelfLocationDiffs(tx, [{ productId: "p1", diff }], NOW);
    assert.deepEqual(
      [...table.values()].map((row) => `${row.rackId}-${row.level}${row.isPrimary ? "*" : ""}`).sort(),
      ["rB-2", "rZ-1*"],
    );
  }
});

test("a home swap demotes before it promotes", async () => {
  const rows: Row[] = [
    { id: "a1", productId: "p1", rackId: "rA", level: 1, isPrimary: true, note: null },
    { id: "z1", productId: "p1", rackId: "rZ", level: 1, isPrimary: false, note: null },
  ];
  const result = applyShelfLocationChange(rows.map(draft), { kind: "promote", locationId: "z1" }, racksById, NOW);
  assert.ok(result.ok);
  const { tx, table } = createFakeTx(rows);
  await applyShelfLocationDiffs(tx, [{ productId: "p1", diff: diffShelfLocations(rows.map(draft), result.locations) }], NOW);
  assert.equal(table.get("z1")?.isPrimary, true);
  assert.equal(table.get("a1")?.isPrimary, false);
});

test("batch put-away saves every product it can and reports the ones it cannot", async () => {
  const rows: Row[] = [{ id: "home", productId: "p2", rackId: "rA", level: 1, isPrimary: true, note: null }];
  const racks = [...racksById.values(), { id: "rX", code: "X", levels: 2, isActive: false }];
  const { tx, table } = createFakeTx(rows, racks);

  const results = await changeManyProductShelfLocations(tx, {
    now: NOW,
    entries: [
      // New product: placed on B-2 becomes its home.
      { productId: "p1", resolve: () => [{ kind: "place", target: { rackId: "rB", level: 2 } }] },
      // Already at home: keep it there (confirm only).
      {
        productId: "p2",
        resolve: (locations) => {
          const home = locations.find((location) => location.isPrimary);
          return home ? [{ kind: "confirm", locationId: home.id as string }] : "LOCATION_NOT_FOUND";
        },
      },
      // Inactive rack: refused, nothing written for this product.
      { productId: "p3", resolve: () => [{ kind: "place", target: { rackId: "rX", level: 1 } }] },
      // No home to keep.
      { productId: "p4", resolve: () => "LOCATION_NOT_FOUND" },
    ],
  });

  assert.deepEqual(
    results.map((result) => (result.ok ? `${result.productId}:${result.changed ? "changed" : "confirmed"}:${result.after.join(",")}` : `${result.productId}:${result.error}`)),
    ["p1:changed:B-2 (ประจำ)", "p2:confirmed:A-1 (ประจำ)", "p3:RACK_INACTIVE", "p4:LOCATION_NOT_FOUND"],
  );
  assert.deepEqual(
    [...table.values()].map((row) => `${row.productId}@${row.rackId}-${row.level}${row.isPrimary ? "*" : ""}`).sort(),
    ["p1@rB-2*", "p2@rA-1*"],
  );
});
