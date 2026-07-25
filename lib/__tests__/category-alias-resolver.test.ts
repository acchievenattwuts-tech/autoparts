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

test("raw customer keyword resolves even when the AI rewrote the query", () => {
  // Regression: customer typed "พัดลมโบยาริสปี08" (Blower). The AI dropped "โบ"
  // (partType "พัดลม") and the consolidated query injected "หม้อน้ำ"
  // ("พัดลมหม้อน้ำ Toyota Yaris 2008"), which matches the Condenser Fan Motor
  // alias. Passing the RAW text too must keep the precise "พัดลมโบ" → Blower.
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "พัดลมโบ",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 240,
      isActive: true,
      category: { id: "cat-blower", name: "โบเวอร์ พัดลมแอร์ (Blower Motor)", isActive: true },
    },
    {
      alias: "พัดลมหม้อน้ำ",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 220,
      isActive: true,
      category: {
        id: "cat-condenser-fan",
        name: "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
        isActive: true,
      },
    },
  ];

  // partType="พัดลม", consolidatedQuery="พัดลมหม้อน้ำ...", rawText="พัดลมโบยาริสปี08"
  assert.deepEqual(
    matchCategoryAliasRows(["พัดลม", "พัดลมหม้อน้ำ Toyota Yaris 2008", "พัดลมโบยาริสปี08"], rows),
    {
      kind: "MATCH",
      categoryId: "cat-blower",
      categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
      alias: "พัดลมโบ",
    },
  );
});

test("equal-priority aliases in different texts resolve by text order, not row order", () => {
  // Regression (2026-07-25 production): customer asked for "แผงแอร์" (Condenser);
  // on the price follow-up the classifier rewrote the query to "ตู้แอร์"
  // (Evaporator). Both aliases are priority 240 / same length, so the winner
  // used to be decided by DB row order — "ตู้แอร์" was created first and beat
  // the trusted frame partType. The earlier text (partType) must win the tie.
  const rows: CategoryAliasResolverRow[] = [
    {
      // Deliberately listed FIRST to prove row order no longer decides the tie.
      alias: "ตู้แอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 240,
      isActive: true,
      category: { id: "cat-evap", name: "คอยล์เย็น (Evaporator)", isActive: true },
    },
    {
      alias: "แผงแอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 240,
      isActive: true,
      category: { id: "cat-condenser", name: "คอยล์ร้อน (Condenser)", isActive: true },
    },
  ];

  // partType="แผงแอร์", consolidatedQuery="ตู้แอร์", rawText="ราคาประมาณเท่าไหร่ครับ"
  assert.deepEqual(matchCategoryAliasRows(["แผงแอร์", "ตู้แอร์", "ราคาประมาณเท่าไหร่ครับ"], rows), {
    kind: "MATCH",
    categoryId: "cat-condenser",
    categoryName: "คอยล์ร้อน (Condenser)",
    alias: "แผงแอร์",
  });
});

test("a compound alias suppresses a higher-priority alias nested inside it (longest span wins)", () => {
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "คอนเดนเซอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 240,
      isActive: true,
      category: { id: "cat-condenser", name: "คอยล์ร้อน (Condenser)", isActive: true },
    },
    {
      alias: "พัดลมคอนเดนเซอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 225,
      isActive: true,
      category: { id: "cat-cfm", name: "มอเตอร์พัดลมหน้าเครื่อง (Condenser Fan Motor)", isActive: true },
    },
    {
      alias: "ตู้แอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 240,
      isActive: true,
      category: { id: "cat-evap", name: "คอยล์เย็น (Evaporator)", isActive: true },
    },
    {
      alias: "มอเตอร์ตู้แอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 220,
      isActive: true,
      category: { id: "cat-blower", name: "โบเวอร์ พัดลมแอร์ (Blower Motor)", isActive: true },
    },
  ];

  // The customer typed the COMPOUND word — the nested short alias must not
  // hijack the category on priority alone.
  assert.equal(
    matchCategoryAliasRows(["พัดลมคอนเดนเซอร์ d-max"], rows)?.categoryName,
    "มอเตอร์พัดลมหน้าเครื่อง (Condenser Fan Motor)",
  );
  assert.equal(
    matchCategoryAliasRows(["มอเตอร์ตู้แอร์ vigo"], rows)?.categoryName,
    "โบเวอร์ พัดลมแอร์ (Blower Motor)",
  );
  // The short alias standing ALONE still resolves exactly as before.
  assert.equal(
    matchCategoryAliasRows(["คอนเดนเซอร์ d-max"], rows)?.categoryName,
    "คอยล์ร้อน (Condenser)",
  );
  assert.equal(matchCategoryAliasRows(["ตู้แอร์ vigo"], rows)?.categoryName, "คอยล์เย็น (Evaporator)");
});

test("non-overlapping matches in one text keep the priority ordering", () => {
  const rows: CategoryAliasResolverRow[] = [
    {
      alias: "กรองแอร์",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 220,
      isActive: true,
      category: { id: "cat-cabin", name: "กรองแอร์ (Cabin air filter)", isActive: true },
    },
    {
      alias: "กรองอากาศ",
      kind: "MATCH",
      matchMode: "CONTAINS",
      priority: 230,
      isActive: true,
      category: { id: "cat-air", name: "กรองอากาศ (Air Filter)", isActive: true },
    },
  ];

  // Two separate part words side by side (multi-subject territory): the single
  // resolver still picks by priority, unchanged from before.
  assert.equal(
    matchCategoryAliasRows(["กรองแอร์กับกรองอากาศ d-max"], rows)?.categoryName,
    "กรองอากาศ (Air Filter)",
  );
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
