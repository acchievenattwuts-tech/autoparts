import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCarModelGroundingLookup,
  buildCarModelVariantLookup,
} from "@/lib/car-model-alias-cache";

test("maps every spelling of a cluster to the full variant list", () => {
  const lookup = buildCarModelVariantLookup([
    { term: "Strada", synonyms: ["สตาด้า", "สตราด้า", "Mitsubishi Strada"] },
  ]);
  // Lookup by the English canonical OR the Thai spelling returns the same cluster.
  const byEng = lookup.get("strada");
  const byThai = lookup.get("สตาด้า");
  assert.ok(byEng);
  assert.deepEqual(byEng, byThai);
  assert.ok(byEng?.includes("สตาด้า"));
  assert.ok(byEng?.includes("strada"));
});

test("skips blank members and lowercases keys", () => {
  const lookup = buildCarModelVariantLookup([
    { term: "  Vigo ", synonyms: ["", "  ", "วีโก้"] },
  ]);
  assert.deepEqual(lookup.get("vigo"), ["vigo", "วีโก้"]);
  assert.equal(lookup.get(""), undefined);
});

test("grounding lookup excludes spellings shared by different canonical models", () => {
  const lookup = buildCarModelGroundingLookup([
    { term: "Hiace", synonyms: ["ไฮเอซ", "Toyota Hiace"] },
    { term: "Hiace Commuter", synonyms: ["ไฮเอซ", "Commuter"] },
  ]);

  assert.ok(lookup.get("hiace")?.safeVariants.includes("toyota hiace"));
  assert.equal(lookup.get("hiace")?.canonicalTerm, "Hiace");
  assert.ok(lookup.get("hiace")?.ambiguousVariants.includes("ไฮเอซ"));
  assert.ok(!lookup.get("hiace commuter")?.safeVariants.includes("ไฮเอซ"));
});

test("grounding lookup merges case-only duplicate canonical clusters", () => {
  const lookup = buildCarModelGroundingLookup([
    { term: "MIRAGE", synonyms: ["มิราจ"] },
    { term: "Mirage", synonyms: ["มิราจน์"] },
  ]);

  assert.equal(lookup.size, 1);
  assert.equal(lookup.get("mirage")?.canonicalTerm, "MIRAGE");
  assert.deepEqual(
    new Set(lookup.get("mirage")?.safeVariants),
    new Set(["mirage", "มิราจ", "มิราจน์"]),
  );
});
