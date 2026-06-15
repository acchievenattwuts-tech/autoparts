import test from "node:test";
import assert from "node:assert/strict";

import {
  getCachedCategoryAliasRows,
  invalidateCategoryAliasCache,
} from "@/lib/category-alias-cache";
import type { CategoryAliasResolverRow } from "@/lib/category-alias-resolver";

const row = (alias: string): CategoryAliasResolverRow => ({
  alias,
  kind: "MATCH",
  matchMode: "CONTAINS",
  priority: 0,
  isActive: true,
  category: { id: `cat-${alias}`, name: alias, isActive: true },
});

test("reuses alias rows from memory cache within the TTL", async () => {
  invalidateCategoryAliasCache();
  let calls = 0;
  const loadRows = async () => {
    calls += 1;
    return [row(`alias-${calls}`)];
  };

  const first = await getCachedCategoryAliasRows(loadRows, { now: () => 1_000, ttlMs: 60_000 });
  const second = await getCachedCategoryAliasRows(loadRows, { now: () => 2_000, ttlMs: 60_000 });

  assert.equal(calls, 1);
  assert.equal(first[0].alias, "alias-1");
  assert.equal(second[0].alias, "alias-1");
});

test("reloads alias rows after explicit invalidation", async () => {
  invalidateCategoryAliasCache();
  let calls = 0;
  const loadRows = async () => {
    calls += 1;
    return [row(`alias-${calls}`)];
  };

  await getCachedCategoryAliasRows(loadRows, { now: () => 1_000, ttlMs: 60_000 });
  invalidateCategoryAliasCache();
  const afterInvalidate = await getCachedCategoryAliasRows(loadRows, { now: () => 2_000, ttlMs: 60_000 });

  assert.equal(calls, 2);
  assert.equal(afterInvalidate[0].alias, "alias-2");
});

test("reloads alias rows after the TTL expires", async () => {
  invalidateCategoryAliasCache();
  let calls = 0;
  const loadRows = async () => {
    calls += 1;
    return [row(`alias-${calls}`)];
  };

  await getCachedCategoryAliasRows(loadRows, { now: () => 1_000, ttlMs: 60_000 });
  const afterTtl = await getCachedCategoryAliasRows(loadRows, { now: () => 61_001, ttlMs: 60_000 });

  assert.equal(calls, 2);
  assert.equal(afterTtl[0].alias, "alias-2");
});
