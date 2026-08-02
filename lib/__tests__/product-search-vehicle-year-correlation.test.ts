import assert from "node:assert/strict";
import test from "node:test";

// product-search.ts constructs the db client at import; supply a dummy URL. No
// query runs here — buildCorrelatedIdVehicleYearSome is a pure predicate builder.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// ── Golden suite: the year must sit on the SAME fitment row as the vehicle ────
// The dropdown filters pass carModelId / carBrandId, and the year used to be a
// SEPARATE `carModels: { some }` — two independent EXISTS. A product could pass
// the model on one row and the year on another. Reproduced on production data
// 2026-08-02: filtering Blower + Honda Jazz + 2010 listed a Toyota Hilux Vigo
// blower whose Jazz row starts at 2014, because its own Vigo (2005-2014) and
// Altis (2008-2017) rows covered the year instead. Correlating drops it (4 → 2).

const load = async () => {
  const mod = await import("@/lib/product-search");
  return mod.buildCorrelatedIdVehicleYearSome;
};

type Predicate = Record<string, unknown> | null;

test("carModelId + a year range is correlated onto one fitment row", async () => {
  const build = await load();
  const predicate = build(
    { carModelId: "model-jazz" } as Parameters<typeof build>[0],
    null,
    2010,
    2010,
  ) as Predicate;

  assert.ok(predicate, "a predicate is produced");
  assert.equal(predicate?.carModelId, "model-jazz", "the vehicle rides on the same row…");
  assert.ok(Array.isArray(predicate?.AND), "…as the year conditions");
  assert.equal((predicate?.AND as unknown[]).length, 1, "one range condition");
});

test("carBrandId + a year range is correlated too", async () => {
  const build = await load();
  const predicate = build(
    { carBrandId: "brand-honda" } as Parameters<typeof build>[0],
    null,
    2010,
    null,
  ) as Predicate;

  assert.deepEqual(
    predicate?.carModel,
    { carBrandId: "brand-honda" },
    "brand scope is carried on the same row as the year",
  );
  assert.ok(Array.isArray(predicate?.AND));
});

test("carModelId wins over carBrandId (the narrower scope)", async () => {
  const build = await load();
  const predicate = build(
    { carModelId: "model-jazz", carBrandId: "brand-honda" } as Parameters<typeof build>[0],
    null,
    2010,
    2010,
  ) as Predicate;

  assert.equal(predicate?.carModelId, "model-jazz");
  assert.equal(predicate?.carModel, undefined, "the brand predicate is not stacked on top");
});

test("a single target year is correlated as well as a range", async () => {
  const build = await load();
  const predicate = build(
    { carModelId: "model-jazz" } as Parameters<typeof build>[0],
    2010,
    null,
    null,
  ) as Predicate;

  assert.equal(predicate?.carModelId, "model-jazz");
  const conditions = predicate?.AND as Array<Record<string, unknown>>;
  assert.equal(conditions.length, 1);
  assert.ok(Array.isArray(conditions[0]?.OR), "target-year form is the 4-way OR (open bounds allowed)");
});

test("a target year AND a range are both correlated onto the same row", async () => {
  const build = await load();
  const predicate = build(
    { carModelId: "model-jazz" } as Parameters<typeof build>[0],
    2010,
    2012,
    2015,
  ) as Predicate;

  assert.equal((predicate?.AND as unknown[]).length, 2, "target-year and range conditions both applied");
});

test("no year filter → no extra predicate (behaviour unchanged)", async () => {
  const build = await load();
  assert.equal(
    build({ carModelId: "model-jazz" } as Parameters<typeof build>[0], null, null, null),
    null,
    "browsing a model with no year must not gain a hidden year condition",
  );
});

test("no id scope → no extra predicate (name-based scope keeps its own path)", async () => {
  const build = await load();
  // Name-based queries (the chat) are correlated by buildCorrelatedVehicleYearSome;
  // this builder must stay out of their way.
  assert.equal(
    build({ carModelName: "Jazz" } as Parameters<typeof build>[0], 2010, null, null),
    null,
  );
  assert.equal(build({} as Parameters<typeof build>[0], 2010, 2010, 2010), null, "no vehicle at all");
});
