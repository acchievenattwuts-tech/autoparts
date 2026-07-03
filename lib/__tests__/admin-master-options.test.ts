import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("loadActiveCategoryOptions retries once on a transient connection failure", async () => {
  const { loadActiveCategoryOptions } = await import("@/lib/admin-master-options");
  const { db } = await import("@/lib/db");

  const originalFindMany = db.category.findMany;
  let attempts = 0;
  const expectedRows = [{ id: "cat-1", name: "Compressors", isActive: true }];

  db.category.findMany = (async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Connection terminated due to connection timeout");
    }
    return expectedRows;
  }) as unknown as typeof db.category.findMany;

  try {
    assert.equal(typeof loadActiveCategoryOptions, "function");
    const result = await loadActiveCategoryOptions();
    assert.deepEqual(result, expectedRows);
    assert.equal(attempts, 2);
  } finally {
    db.category.findMany = originalFindMany;
  }
});

test("loadActiveCarBrandOptionsWithModels retries once on a transient connection failure", async () => {
  const { loadActiveCarBrandOptionsWithModels } = await import("@/lib/admin-master-options");
  const { db } = await import("@/lib/db");

  const originalFindMany = db.carBrand.findMany;
  let attempts = 0;
  const expectedRows = [
    {
      id: "brand-1",
      name: "Toyota",
      isActive: true,
      carModels: [{ id: "model-1", name: "Hilux", isActive: true }],
    },
  ];

  db.carBrand.findMany = (async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Connection terminated unexpectedly");
    }
    return expectedRows;
  }) as unknown as typeof db.carBrand.findMany;

  try {
    assert.equal(typeof loadActiveCarBrandOptionsWithModels, "function");
    const result = await loadActiveCarBrandOptionsWithModels();
    assert.deepEqual(result, expectedRows);
    assert.equal(attempts, 2);
  } finally {
    db.carBrand.findMany = originalFindMany;
  }
});
