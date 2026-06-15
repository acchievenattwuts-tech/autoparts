import test from "node:test";
import assert from "node:assert/strict";

import { getCategoryAliasCoverageGaps, type CategoryAliasCoverageCategory } from "@/lib/category-alias-audit";

test("reports active categories without active match aliases", () => {
  const categories: CategoryAliasCoverageCategory[] = [
    {
      id: "cat-covered",
      name: "Covered",
      isActive: true,
      aliases: [{ kind: "MATCH", isActive: true }],
    },
    {
      id: "cat-skip-only",
      name: "Skip Only",
      isActive: true,
      aliases: [{ kind: "SKIP_CATEGORY", isActive: true }],
    },
    {
      id: "cat-inactive-alias",
      name: "Inactive Alias",
      isActive: true,
      aliases: [{ kind: "MATCH", isActive: false }],
    },
    {
      id: "cat-inactive-category",
      name: "Inactive Category",
      isActive: false,
      aliases: [],
    },
  ];

  assert.deepEqual(getCategoryAliasCoverageGaps(categories), [
    { id: "cat-skip-only", name: "Skip Only" },
    { id: "cat-inactive-alias", name: "Inactive Alias" },
  ]);
});
