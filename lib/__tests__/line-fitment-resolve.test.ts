import test from "node:test";
import assert from "node:assert/strict";
import { buildCarModelVariantLookup } from "@/lib/car-model-alias-cache";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("canonicalizes model aliases with safe generation and engine qualifiers", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup([
    { term: "Mazda", synonyms: [] },
    { term: "MG", synonyms: [] },
    { term: "CRV", synonyms: ["CR-V", "ซีอาร์วี"] },
    { term: "HRV", synonyms: ["HR-V", "เอชอาร์วี"] },
    { term: "BRV", synonyms: ["BR-V", "บีอาร์วี"] },
    { term: "CX-3", synonyms: ["CX3", "ซีเอ็กซ์3"] },
    { term: "CX-5", synonyms: ["CX5", "ซีเอ็กซ์5"] },
    { term: "BT-50", synonyms: ["BT50", "บีที50"] },
    { term: "MU-X", synonyms: ["MUX", "MU X"] },
    { term: "D-Max", synonyms: ["DMax", "D Max"] },
    { term: "Mazda3", synonyms: ["Mazda 3"] },
    { term: "MG3", synonyms: ["MG 3"] },
  ]);

  const cases = [
    ["CR-V G3 2.0", "crv", "g3 2.0"],
    ["HR-V Gen 2 1.8", "hrv", "gen 2 1.8"],
    ["BR-V G2 1.5", "brv", "g2 1.5"],
    ["CX3 G2 2.0", "cx-3", "g2 2.0"],
    ["CX5 Gen 2 2.5", "cx-5", "gen 2 2.5"],
    ["BT50 G2 3.2", "bt-50", "g2 3.2"],
    ["MU X Gen 2 1.9", "mu-x", "gen 2 1.9"],
    ["D Max G2 1.9", "d-max", "g2 1.9"],
    ["Mazda 3 2.0", "mazda3", "2.0"],
    ["MG 3 1.5", "mg3", "1.5"],
  ] as const;

  for (const [input, canonicalModel, qualifier] of cases) {
    assert.deepEqual(
      resolveCanonicalCarModelHint(input, lookup),
      { canonicalModel, qualifier },
      input,
    );
  }
});

test("does not strip digits from real model names or arbitrary model suffixes", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup([
    { term: "MG3", synonyms: ["MG 3"] },
    { term: "CX-3", synonyms: ["CX3"] },
  ]);

  assert.deepEqual(resolveCanonicalCarModelHint("MG3", lookup), {
    canonicalModel: "mg3",
    qualifier: null,
  });
  assert.deepEqual(resolveCanonicalCarModelHint("CX-3", lookup), {
    canonicalModel: "cx-3",
    qualifier: null,
  });
  assert.equal(resolveCanonicalCarModelHint("MG3 hatchback", lookup), null);
  assert.equal(resolveCanonicalCarModelHint("CX3 diesel turbo", lookup), null);
});

test("maps colloquial part-types to the right category hint", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/chat-core/fitment-resolve");
  assert.equal(matchPartTypeToCategoryHint("วาล์วแอร์"), "(Expansion Valve)");
  assert.equal(matchPartTypeToCategoryHint("คอยเย็น"), "(Evaporator)");
  assert.equal(matchPartTypeToCategoryHint("คอยล์เย็น"), "(Evaporator)");
  assert.equal(matchPartTypeToCategoryHint("แผงแอร์"), "(Condenser)");
  assert.equal(matchPartTypeToCategoryHint("คอมแอร์"), "(Compressor)");
  assert.equal(matchPartTypeToCategoryHint("กรองแอร์"), "Cabin air filter");
  assert.equal(matchPartTypeToCategoryHint("ไดรเออร์"), "Drier");
});

test("explicit A/C valve terms map to Expansion Valve; bare valve stays ambiguous", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/chat-core/fitment-resolve");
  // A/C-explicit spellings (incl. the letter-order misspellings + "แอร์") still map.
  assert.equal(matchPartTypeToCategoryHint("วาว์ลแอร์"), "(Expansion Valve)");
  assert.equal(matchPartTypeToCategoryHint("วาวล์แอร์"), "(Expansion Valve)");
  // Bare "วาล์ว" / "วาว์ล" / "วาวล์" are ambiguous (A/C expansion valve vs engine
  // water valve / thermostat) → NOT hardcoded; resolve via DB CategoryAlias or the
  // chat relevance gate hands off instead of guessing.
  assert.equal(matchPartTypeToCategoryHint("วาล์ว"), null);
  assert.equal(matchPartTypeToCategoryHint("วาว์ล"), null);
  assert.equal(matchPartTypeToCategoryHint("วาวล์"), null);
});

test("normalizes colloquial Isuzu all-new model aliases to D-Max", async () => {
  const { resolveColloquialCarModelAlias } = await import("@/lib/chat-core/fitment-resolve");

  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "ออนิว", rawText: "ออนิว" }), {
    brandName: "Isuzu",
    modelName: "D-Max",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: "Isuzu", carModel: "All New", rawText: "All New" }), {
    brandName: "Isuzu",
    modelName: "D-Max",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: "Toyota", carModel: "All New", rawText: "All New" }), null);
});

test("maps safe sub-model / trim aliases to hard model filters", async () => {
  const { resolveColloquialCarModelAlias } = await import("@/lib/chat-core/fitment-resolve");

  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "V-Cross", rawText: "V-Cross" }), {
    brandName: "Isuzu",
    modelName: "D-Max",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: "Toyota", carModel: "Rocco", rawText: "Rocco" }), {
    brandName: "Toyota",
    modelName: "Hilux Revo",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Vigo Champ", rawText: "Vigo Champ" }), {
    brandName: "Toyota",
    modelName: "Hilux Vigo",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Hilux Champ", rawText: "Hilux Champ" }), {
    brandName: "Toyota",
    modelName: "Hilux Champ",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "NP300", rawText: "NP300" }), {
    brandName: "Nissan",
    modelName: "NP300",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Frontier", rawText: "Frontier" }), {
    brandName: "Nissan",
    modelName: "Frontier",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Wildtrak", rawText: "Wildtrak" }), {
    brandName: "Ford",
    modelName: "Ranger",
  });
  assert.deepEqual(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Raptor", rawText: "Raptor" }), {
    brandName: "Ford",
    modelName: "Ranger",
  });
});

test("does not hard-map ambiguous trim words without enough context", async () => {
  const { resolveColloquialCarModelAlias } = await import("@/lib/chat-core/fitment-resolve");

  assert.equal(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Champ", rawText: "Champ" }), null);
  assert.equal(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Ativ", rawText: "Ativ" }), null);
  assert.equal(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Fit", rawText: "Fit" }), null);
  assert.equal(resolveColloquialCarModelAlias({ carBrand: null, carModel: "Mega Cab", rawText: "Mega Cab" }), null);
});

test("disambiguates overlapping substrings via ordering", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/chat-core/fitment-resolve");
  // "วาล์ว" appears in two categories — control valve must win when explicit.
  assert.equal(matchPartTypeToCategoryHint("คอนโทรลวาล์วคอมแอร์"), "Compressor Control Valve");
  // "หม้อน้ำ" appears in Radiator / Radiator Cap / Coolant — specifics win.
  assert.equal(matchPartTypeToCategoryHint("ฝาปิดหม้อน้ำ"), "Radiator Cap");
  assert.equal(matchPartTypeToCategoryHint("น้ำยาหล่อเย็นหม้อน้ำ"), "Radiator Coolant");
  assert.equal(matchPartTypeToCategoryHint("หม้อน้ำ"), "(Radiator)");
  // "คอม" specifics win over the generic compressor.
  assert.equal(matchPartTypeToCategoryHint("น้ำมันคอมแอร์"), "Compressor Oil");
  assert.equal(matchPartTypeToCategoryHint("หน้าครัชคอมแอร์"), "Compressor Clutch");
});

test("does not mis-route a fan-motor part-type to the Condenser category", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/chat-core/fitment-resolve");
  // Regression for the production bug: partType carried the FULL canonical category
  // name, which embeds "หน้าแผงแอร์" + "Condenser". The generic "แผงแอร์"→(Condenser)
  // rule used to win first and route the fan motor to แผงแอร์ (Condenser).
  assert.equal(
    matchPartTypeToCategoryHint("มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)"),
    "Condenser Fan Motor",
  );
  // Colloquial fan-motor keywords resolve to the fan-motor category.
  assert.equal(matchPartTypeToCategoryHint("มอเตอร์พัดลม"), "Condenser Fan Motor");
  assert.equal(matchPartTypeToCategoryHint("พัดลมหน้าแผง"), "Condenser Fan Motor");
  assert.equal(matchPartTypeToCategoryHint("พัดลมหม้อน้ำ"), "Condenser Fan Motor");
  assert.equal(matchPartTypeToCategoryHint("พัดลมหน้าเครื่อง"), "Condenser Fan Motor");
  assert.equal(matchPartTypeToCategoryHint("condenser fan"), "Condenser Fan Motor");
  // Fan blade stays distinct and is not swallowed by the fan-motor entry.
  assert.equal(matchPartTypeToCategoryHint("ใบพัดลม"), "Cooling Fan Blade");
  // Regression: a genuine Condenser (แผงแอร์) part-type must still resolve to Condenser.
  assert.equal(matchPartTypeToCategoryHint("แผงแอร์"), "(Condenser)");
  assert.equal(matchPartTypeToCategoryHint("คอยล์ร้อน"), "(Condenser)");
  assert.equal(matchPartTypeToCategoryHint("รังผึ้งแอร์"), "(Condenser)");
  // Blower stays distinct too.
  assert.equal(matchPartTypeToCategoryHint("พัดลมแอร์"), "Blower Motor)");
});

test("returns null for unknown / empty part-types", async () => {
  const { matchPartTypeToCategoryHint } = await import("@/lib/chat-core/fitment-resolve");
  assert.equal(matchPartTypeToCategoryHint("อะไหล่แปลกๆ"), null);
  assert.equal(matchPartTypeToCategoryHint(""), null);
  assert.equal(matchPartTypeToCategoryHint(null), null);
});

test("skips the part-category hint for accessory / chemical intents", async () => {
  const { matchPartTypeToCategoryHint, isAccessoryOrChemicalIntent } = await import(
    "@/lib/chat-core/fitment-resolve"
  );
  // The bug case: cleaner name embeds "คอยเย็น" but must NOT resolve to Evaporator.
  assert.equal(matchPartTypeToCategoryHint("น้ำยาล้างคอยเย็น"), null);
  assert.equal(matchPartTypeToCategoryHint("น้ำยาล้างแผงร้อน"), null); // not Condenser
  assert.equal(matchPartTypeToCategoryHint("ฟองน้ำเส้นตู้แอร์"), null); // not Evaporator
  assert.equal(matchPartTypeToCategoryHint("ฝาปิดกล่องกรองแอร์"), null); // not Cabin filter
  assert.equal(matchPartTypeToCategoryHint("ฝาปิดวาล์วเติมน้ำยาแอร์"), null); // not Expansion Valve
  assert.equal(matchPartTypeToCategoryHint("น็อตขันวาล์วแอร์"), null); // not Expansion Valve
  assert.equal(matchPartTypeToCategoryHint("วาล์วลูกศรแอร์"), null); // not Expansion Valve

  // Legit part queries are unaffected.
  assert.equal(matchPartTypeToCategoryHint("คอยเย็น"), "(Evaporator)");
  assert.equal(matchPartTypeToCategoryHint("วาล์วแอร์"), "(Expansion Valve)");
  assert.equal(matchPartTypeToCategoryHint("ฝาปิดหม้อน้ำ"), "Radiator Cap"); // radiator cap stays
  assert.equal(matchPartTypeToCategoryHint("คอนโทรลวาล์วคอมแอร์"), "Compressor Control Valve");

  assert.equal(isAccessoryOrChemicalIntent("น้ำยาล้างคอยเย็น"), true);
  assert.equal(isAccessoryOrChemicalIntent("คอยเย็น"), false);
});
