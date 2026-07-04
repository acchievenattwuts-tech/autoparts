import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// Typed only — the value is imported dynamically inside each test AFTER the env var
// is set above (a top-level import is hoisted and would eval lib/db before then).
import type { Entry } from "@/lib/chat-core/known-query-intent";

const entries = (map: Record<string, Entry[]>): Map<string, Entry[]> =>
  new Map(Object.entries(map));

test("Option A: promotes a synonym misspelling to the carModel hard filter", async () => {
  // "starda" resolved only to a synonym whose canonical term is "Strada"; the
  // synonym term re-resolves to a carModel. It must become carModelName.
  const { deriveKnownQueryFilters } = await import("@/lib/chat-core/known-query-intent");
  const result = deriveKnownQueryFilters({
    dictionaryNorms: ["หม้อน้ำ", "starda"],
    entriesByNorm: entries({
      "หม้อน้ำ": [{ kind: "category", term: "หม้อน้ำ (Radiator)" }],
      starda: [{ kind: "synonym", term: "Strada" }],
    }),
    expandedByNorm: entries({
      strada: [{ kind: "carModel", term: "Strada" }],
    }),
    requiredTokens: ["2500"],
  });
  assert.equal(result.carModelName, "Strada");
  assert.equal(result.categoryName, "หม้อน้ำ (Radiator)");
  // category + carModel now present → self-contained (not because of the bare code).
  assert.equal(result.contextFree, true);
});

test("Option A: a synonym that maps to a part (not a vehicle) does NOT become a filter", async () => {
  const { deriveKnownQueryFilters } = await import("@/lib/chat-core/known-query-intent");
  const result = deriveKnownQueryFilters({
    dictionaryNorms: ["คอมแอร์"],
    entriesByNorm: entries({
      คอมแอร์: [{ kind: "synonym", term: "คอมเพรสเซอร์" }],
    }),
    // The synonym term only expands to a product/synonym — no vehicle/category.
    expandedByNorm: entries({}),
    requiredTokens: [],
  });
  assert.equal(result.carModelName, null);
  assert.equal(result.carBrandName, null);
  assert.equal(result.categoryName, null);
  assert.equal(result.contextFree, false);
});

test("Option B: a bare numeric token (engine cc) does NOT alone make the query context-free", async () => {
  // "หม้อน้ำ 2500" with no vehicle: category only + numeric code must fall to the LLM.
  const { deriveKnownQueryFilters } = await import("@/lib/chat-core/known-query-intent");
  const result = deriveKnownQueryFilters({
    dictionaryNorms: ["หม้อน้ำ"],
    entriesByNorm: entries({
      "หม้อน้ำ": [{ kind: "category", term: "หม้อน้ำ (Radiator)" }],
    }),
    expandedByNorm: entries({}),
    requiredTokens: ["2500"],
  });
  assert.equal(result.categoryName, "หม้อน้ำ (Radiator)");
  assert.equal(result.carModelName, null);
  assert.equal(result.contextFree, false);
});

test("Option B: a real part-number anchor (letters/hyphen) stays context-free", async () => {
  const { deriveKnownQueryFilters } = await import("@/lib/chat-core/known-query-intent");
  const result = deriveKnownQueryFilters({
    dictionaryNorms: [],
    entriesByNorm: entries({}),
    expandedByNorm: entries({}),
    requiredTokens: ["stj-0130-p26"],
  });
  assert.equal(result.contextFree, true);
});

test("direct carModel/category entries still win without any synonym expansion", async () => {
  const { deriveKnownQueryFilters } = await import("@/lib/chat-core/known-query-intent");
  const result = deriveKnownQueryFilters({
    dictionaryNorms: ["หม้อน้ำ", "vios"],
    entriesByNorm: entries({
      "หม้อน้ำ": [{ kind: "category", term: "หม้อน้ำ (Radiator)" }],
      vios: [{ kind: "carModel", term: "Vios" }],
    }),
    expandedByNorm: entries({}),
    requiredTokens: [],
  });
  assert.equal(result.carModelName, "Vios");
  assert.equal(result.categoryName, "หม้อน้ำ (Radiator)");
  assert.equal(result.contextFree, true);
});
