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

// ── Golden suite: letter-led chassis/generation codes ────────────────────────
// Thai buyers name a Honda by its generation ("Jazz GE", "Civic FD") the way they
// name a Toyota by its year. Before these codes were accepted as qualifiers the
// model never resolved to a hard fitment filter, so the vehicle-unresolved guard
// suppressed perfectly good matches and handed the customer to an admin — the
// 2026-08-01 "โบลเวอร์พัดลมแอร์ jazz ge" turn, where the shop stocked the part.
// Every code below is mined from this shop's own product names or inbound chat.

const GENERATION_LOOKUP_ROWS = [
  { term: "Jazz", synonyms: ["แจ๊ส", "fit"] },
  { term: "City", synonyms: ["ซิตี้"] },
  { term: "Civic", synonyms: ["ซีวิค"] },
  { term: "CRV", synonyms: ["CR-V"] },
  { term: "Accord", synonyms: ["แอคคอร์ด"] },
  { term: "Freed", synonyms: [] },
  { term: "HRV", synonyms: ["HR-V"] },
  { term: "BRV", synonyms: ["BR-V"] },
  { term: "Mobilio", synonyms: [] },
  { term: "Navara", synonyms: ["นาวาร่า"] },
  { term: "NP300", synonyms: [] },
  { term: "Frontier", synonyms: [] },
  { term: "Teana", synonyms: [] },
  { term: "X-Trail", synonyms: ["Xtrail"] },
  { term: "Almera", synonyms: [] },
  { term: "March", synonyms: [] },
  { term: "Note", synonyms: [] },
  { term: "Urvan", synonyms: [] },
  { term: "Sylphy", synonyms: [] },
  { term: "Triton", synonyms: ["ไทรทัน"] },
  { term: "Pajero Sport", synonyms: [] },
  { term: "Lancer", synonyms: [] },
  { term: "Ranger", synonyms: [] },
  { term: "Everest", synonyms: [] },
  { term: "D-Max", synonyms: ["DMax"] },
  { term: "TFR", synonyms: [] },
  { term: "Mazda2", synonyms: ["Mazda 2"] },
  { term: "Mazda3", synonyms: ["Mazda 3"] },
  { term: "BT-50", synonyms: ["BT50"] },
  { term: "CX-5", synonyms: ["CX5"] },
  { term: "Colorado", synonyms: [] },
  { term: "Swift", synonyms: [] },
  { term: "H-1", synonyms: [] },
  // Real models whose NAMES look like generation codes — the guard must never
  // let a code swallow one of these.
  { term: "MG", synonyms: [] },
  { term: "MG HS", synonyms: [] },
  { term: "MG GT", synonyms: [] },
  { term: "MG ZS", synonyms: [] },
  { term: "IS", synonyms: [] },
  { term: "GS", synonyms: [] },
];

test("accepts the chassis/generation codes Thai buyers actually say", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup(GENERATION_LOOKUP_ROWS);

  const cases: ReadonlyArray<readonly [string, string, string]> = [
    // Honda — the generation IS the common name here
    ["Jazz GD", "jazz", "gd"],
    ["jazz ge", "jazz", "ge"],
    ["Jazz GK", "jazz", "gk"],
    ["Jazz GR", "jazz", "gr"],
    ["City ZX", "city", "zx"],
    ["City GM", "city", "gm"],
    ["City GM6", "city", "gm6"],
    ["City GN", "city", "gn"],
    ["Civic ES", "civic", "es"],
    ["Civic FD", "civic", "fd"],
    ["Civic FB", "civic", "fb"],
    ["Civic FC", "civic", "fc"],
    ["Civic FE", "civic", "fe"],
    ["CR-V RD", "crv", "rd"],
    ["CR-V RE", "crv", "re"],
    ["CR-V RM", "crv", "rm"],
    ["Freed GB3", "freed", "gb3"],
    ["HR-V RU", "hrv", "ru"],
    ["BR-V DG", "brv", "dg"],
    ["Mobilio DD", "mobilio", "dd"],
    // Nissan
    ["Navara D40", "navara", "d40"],
    ["Navara D23", "navara", "d23"],
    ["NP300 D23", "np300", "d23"],
    ["Frontier D22", "frontier", "d22"],
    ["Teana J31", "teana", "j31"],
    ["Teana J32", "teana", "j32"],
    ["Teana L33", "teana", "l33"],
    ["X-Trail T30", "x-trail", "t30"],
    ["X-Trail T31", "x-trail", "t31"],
    ["X-Trail T32", "x-trail", "t32"],
    ["Almera N17", "almera", "n17"],
    ["March K13", "march", "k13"],
    ["Note E12", "note", "e12"],
    ["Urvan E25", "urvan", "e25"],
    ["Urvan E26", "urvan", "e26"],
    ["Sylphy B17", "sylphy", "b17"],
    // Mitsubishi
    ["Triton KA4", "triton", "ka4"],
    ["Triton KB4", "triton", "kb4"],
    ["Triton KL", "triton", "kl"],
    ["Pajero Sport KH4", "pajero sport", "kh4"],
    ["Pajero Sport KS", "pajero sport", "ks"],
    ["Lancer EX", "lancer", "ex"],
    ["Lancer CK", "lancer", "ck"],
    ["Lancer CS", "lancer", "cs"],
    // Ford / Isuzu
    ["Ranger T6", "ranger", "t6"],
    ["Ranger T8", "ranger", "t8"],
    ["Everest UA", "everest", "ua"],
    ["D-Max RT50", "d-max", "rt50"],
    ["D-Max RG", "d-max", "rg"],
    ["TFR M16", "tfr", "m16"],
    // Mazda / Chevrolet / Suzuki / Hyundai
    ["Mazda2 DE", "mazda2", "de"],
    ["Mazda2 DJ", "mazda2", "dj"],
    ["Mazda3 BK", "mazda3", "bk"],
    ["Mazda3 BL", "mazda3", "bl"],
    ["Mazda3 BM", "mazda3", "bm"],
    ["Mazda3 BP", "mazda3", "bp"],
    ["BT-50 UN", "bt-50", "un"],
    ["BT-50 UP", "bt-50", "up"],
    ["CX-5 KE", "cx-5", "ke"],
    ["CX-5 KF", "cx-5", "kf"],
    ["Colorado RC", "colorado", "rc"],
    ["Swift ZC", "swift", "zc"],
    ["H-1 A1", "h-1", "a1"],
  ];

  for (const [input, canonicalModel, qualifier] of cases) {
    assert.deepEqual(
      resolveCanonicalCarModelHint(input, lookup),
      { canonicalModel, qualifier },
      input,
    );
  }
});

test("a code that is itself a real model is a second model, not a qualifier", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup(GENERATION_LOOKUP_ROWS);

  // TFR is a real Isuzu model, so "D-Max TFR" names two models and must not
  // collapse to D-Max. This guard reads master data, so a model added later is
  // protected without touching MODEL_GENERATION_CODES.
  assert.equal(resolveCanonicalCarModelHint("D-Max TFR", lookup), null);
});

test("a real model whose NAME looks like a generation code still wins", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup(GENERATION_LOOKUP_ROWS);

  // Direct match runs first, so these resolve to themselves rather than being
  // read as "MG" + a qualifier.
  for (const name of ["MG HS", "MG GT", "MG ZS"]) {
    assert.deepEqual(
      resolveCanonicalCarModelHint(name, lookup),
      { canonicalModel: name.toLowerCase(), qualifier: null },
      name,
    );
  }
});

test("Toyota chassis codes are deliberately NOT accepted", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup([
    ...GENERATION_LOOKUP_ROWS,
    { term: "Vios", synonyms: [] },
    { term: "Camry", synonyms: [] },
    { term: "Altis", synonyms: [] },
  ]);

  // Thai customers date a Toyota by year ("อัลติสปี 12"), never by chassis code,
  // and this shop writes zero Toyota codes in its product names — so these stay
  // out of the vocabulary rather than being added speculatively.
  for (const input of ["Vios NCP93", "Camry ACV40", "Altis ZRE142"]) {
    assert.equal(resolveCanonicalCarModelHint(input, lookup), null, input);
  }
});

test("arbitrary words after a model are still rejected", async () => {
  const { resolveCanonicalCarModelHint } = await import("@/lib/chat-core/fitment-resolve");
  const lookup = buildCarModelVariantLookup(GENERATION_LOOKUP_ROWS);

  // Trim levels, transmissions and engine layouts are not generations. They must
  // not become qualifiers — the shop reviews those case by case.
  for (const input of [
    "Ranger XL",
    "Accord V6",
    "Jazz hatchback",
    "Civic turbo diesel",
    "City sedan 4 ประตู",
  ]) {
    assert.equal(resolveCanonicalCarModelHint(input, lookup), null, input);
  }
});
