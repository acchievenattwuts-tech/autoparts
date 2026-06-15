import test from "node:test";
import assert from "node:assert/strict";

import {
  matchCategoryAliasRows,
  type CategoryAliasResolverRow,
} from "@/lib/category-alias-resolver";

test("matches active DB category aliases before hardcoded fallbacks", () => {
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "radiator hose",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 10,
      isActive: true,
      category: { id: "cat-radiator-hose", name: "ท่อยางหม้อน้ำ (Radiator Hose)", isActive: true },
    },
  ];

  assert.deepEqual(matchCategoryAliasRows(["Need radiator hose d-max"], rows), {
    kind: "MATCH",
    categoryId: "cat-radiator-hose",
    categoryName: "ท่อยางหม้อน้ำ (Radiator Hose)",
    alias: "radiator hose",
  });
});

test("skip aliases win over category aliases when both match the same text", () => {
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "coil cleaner",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 100,
      isActive: true,
      category: { id: "cat-evap", name: "คอยล์เย็น (Evaporator)", isActive: true },
    },
    {
      alias: "cleaner",
      kind: "SKIP_CATEGORY",
      matchMode: "CONTAINS",
      priority: 1,
      isActive: true,
      category: null,
    },
  ];

  assert.deepEqual(matchCategoryAliasRows(["coil cleaner evaporator"], rows), {
    kind: "SKIP_CATEGORY",
    alias: "cleaner",
  });
});

test("ignores inactive aliases and inactive categories", () => {
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "inactive alias",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 10,
      isActive: false,
      category: { id: "cat-active", name: "Active", isActive: true },
    },
    {
      alias: "inactive category",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 10,
      isActive: true,
      category: { id: "cat-inactive", name: "Inactive", isActive: false },
    },
  ];

  assert.equal(matchCategoryAliasRows(["inactive alias inactive category"], rows), null);
});
