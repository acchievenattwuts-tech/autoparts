import test from "node:test";
import assert from "node:assert/strict";

import { buildCarModelVariantLookup } from "@/lib/car-model-alias-cache";

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
