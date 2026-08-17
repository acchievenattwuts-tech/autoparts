import { db } from "@/lib/db";
import { getCachedCategoryAliasRows } from "@/lib/category-alias-cache";
import { matchCategoryAliasRows } from "@/lib/category-alias-resolver";
import { loadCarModelVariantLookup } from "@/lib/car-model-alias-loader";
import type { CarModelVariantLookup } from "@/lib/car-model-alias-cache";
import { resolveChatProductSpecs } from "@/lib/chat-core/product-spec-resolve";

/**
 * Resolves the AI-extracted fitment hints (free-text brand/model/part type) to the
 * EXACT canonical names stored in master data, so they can be used as hard filters
 * in product search (which match by exact name `IN (...)`).
 *
 * Safety-first: a hint becomes a hard filter ONLY when it resolves to a real,
 * active master row. An unresolved hint is dropped (left to the free-text query),
 * so a typo or an unknown brand can never zero-out an otherwise valid search.
 */

export type ChatFitmentFilterInput = {
  partType?: string | null;
  carBrand?: string | null;
  carModel?: string | null;
  /**
   * The full customer query / consolidated text. Used to detect accessory /
   * chemical intent even when the AI shortened `partType` to a bare part keyword
   * (e.g. text "น้ำยาล้างคอยเย็น" but partType "คอยเย็น"). Brand/model are still
   * resolved normally — only the part-category hard filter is skipped.
   */
  queryText?: string | null;
  /**
   * The RAW, unedited customer text. The AI's `partType`/`queryText` may drop a
   * colloquial signal ("พัดลมโบ" → "พัดลม") or inject a word the customer never
   * typed ("พัดลมหม้อน้ำ"), which mis-routes the category. Matching the alias
   * table against the raw text too keeps a precise customer keyword (e.g.
   * "พัดลมโบ" → Blower Motor) effective regardless of how the AI rewrote it.
   */
  rawText?: string | null;
  /**
   * Cached SearchSynonym lookup already loaded by the channel processor. When it
   * is omitted (for example the LINE multi-subject path), the resolver loads the
   * same cached lookup itself. This keeps canonical model resolution shared by
   * LINE and Messenger without adding an uncached DB read per subject.
   */
  modelLookup?: ReadonlyMap<string, string[]> | null;
};

export type ChatFitmentFilters = {
  categoryName?: string;
  carBrandName?: string;
  carModelName?: string;
  /** Original AI/customer-facing model hint retained for audit/debugging. */
  carModelOriginal?: string;
  /** Safe suffix left after canonical model matching (for example "G3 2.0"). */
  carModelQualifier?: string;
  /** Set when SearchSynonym canonicalization resolved the master model. */
  carModelResolutionSource?: "search_synonym";
};

const trimOrNull = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeAliasText = (value?: string | null): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const normalizeModelSpelling = (value?: string | null): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Chassis/generation codes that Thai buyers say out loud, as a CLOSED vocabulary.
 * Only these letter-led codes may act as a model qualifier — a generic pattern
 * like /[a-z]{2}\d?/ would swallow real model names ("MG HS", "Lexus IS").
 *
 * Every entry is grounded in what this shop and its customers actually write:
 * mined from product names + inbound chat, then cross-checked against the Thai
 * market. Honda leads because its generations ARE the common name here — "Jazz
 * GE", "Civic FD" — the same is true of Nissan (D40, T32) and Mitsubishi (KA4).
 * TOYOTA IS DELIBERATELY ABSENT: Thai customers date a Toyota by year ("อัลติส
 * ปี 12"), never by chassis code, and the shop writes zero Toyota codes.
 *
 * A trailing 1-2 digits is allowed so "GM2"/"GM6"/"GN2" work from the "gm"/"gn"
 * stems. "TFR" is intentionally NOT here — it is a real Isuzu model, and the
 * known-model guard in resolveCanonicalCarModelHint would reject it anyway.
 */
const MODEL_GENERATION_CODES = [
  // Honda — Jazz GD/GE/GK/GR, City GD/GM/GN/ZX, Civic ES/FD/FB/FC/FE,
  // CR-V RD/RE/RM, Freed GB3, HR-V RU, BR-V DG, Mobilio DD
  "gd", "ge", "gk", "gr", "gm", "gn", "zx", "es", "fd", "fb", "fc", "fe",
  "rd", "re", "rm", "gb", "ru", "dg", "dd",
  // Nissan — Navara D40/D23, Frontier D22, Teana J31/J32/L33, X-Trail T30/T31/T32,
  // Almera N17, March K13, Note E12, Urvan E25/E26, Sylphy B17
  "d22", "d23", "d40", "j31", "j32", "l33", "t30", "t31", "t32",
  "n17", "k13", "e12", "e25", "e26", "b17",
  // Mitsubishi — Triton KA4/KB4/KL, Pajero Sport KH4/KS, Lancer EX/CK/CS
  "ka4", "kb4", "kl", "kh4", "ks", "ex", "ck", "cs",
  // Ford — Ranger T6/T8, Everest UA
  "t6", "t8", "ua",
  // Isuzu — D-Max RT50/RG, TFR M16
  "rt50", "rg", "m16",
  // Mazda — Mazda2 DE/DJ, Mazda3 BK/BL/BM/BP, BT-50 UN/UP, CX-5 KE/KF
  "de", "dj", "bk", "bl", "bm", "bp", "un", "up", "ke", "kf",
  // Chevrolet Colorado RC, Suzuki Swift ZC, Hyundai H-1 A1
  "rc", "zc", "a1",
] as const;

const GENERATION_CODE_PATTERN = `(?:${MODEL_GENERATION_CODES.join("|")})\\d{0,2}`;
// Numeric generation ("G3", "Gen 3", "เจน3") or an engine size ("2.0", "1500cc").
const NUMERIC_QUALIFIER_PATTERN =
  "(?:g|gen(?:eration)?|เจน)\\s*-?\\s*\\d+[a-z]?|\\d+(?:\\.\\d+)?(?:\\s*(?:l|liter|litre|ลิตร|cc))?";
const QUALIFIER_ATOM = `(?:${NUMERIC_QUALIFIER_PATTERN}|${GENERATION_CODE_PATTERN})`;

/**
 * Only these suffixes may be stripped from a synonym spelling before it becomes
 * a hard model filter. Keeping the grammar deliberately narrow prevents a short
 * synonym from swallowing arbitrary words or another real model name.
 *
 * Examples accepted: "CR-V G3", "CRV Gen 3", "CR-V G3 2.0", "Jazz GE", "City GM6".
 * A direct synonym match (for example the real model "MG3") is checked first and
 * therefore never gets mistaken for a G3 qualifier.
 */
const SAFE_MODEL_QUALIFIER_RE = new RegExp(
  `^${QUALIFIER_ATOM}(?:[\\s,/+-]+${QUALIFIER_ATOM})*$`,
  "i",
);

export type CanonicalCarModelHint = {
  canonicalModel: string;
  qualifier: string | null;
};

/**
 * Resolves a free-form model hint through the existing SearchSynonym clusters.
 * The first cluster member is the canonical `term` (the cache preserves row
 * order). A suffix match is accepted only when it is made entirely of known
 * generation/engine qualifiers and maps to exactly one canonical cluster.
 */
export function resolveCanonicalCarModelHint(
  value: string | null | undefined,
  lookup: ReadonlyMap<string, string[]> | null | undefined,
): CanonicalCarModelHint | null {
  const candidate = normalizeModelSpelling(value);
  if (!candidate || !lookup || lookup.size === 0) return null;

  const direct = lookup.get(candidate);
  if (direct?.[0]) {
    return { canonicalModel: direct[0], qualifier: null };
  }

  const matches = new Map<string, string>();
  let longestMatchedSpelling = 0;
  for (const [spelling, cluster] of lookup.entries()) {
    const canonicalModel = cluster[0]?.trim();
    const normalizedSpelling = normalizeModelSpelling(spelling);
    // One-character spellings are too ambiguous for prefix-with-suffix matching.
    // They still work through the exact/direct path above.
    if (!canonicalModel || normalizedSpelling.length < 2) continue;

    const match = candidate.match(
      new RegExp(`^${escapeRegex(normalizedSpelling)}[\\s/_-]+(.+)$`, "i"),
    );
    const qualifier = match?.[1]?.trim();
    if (!qualifier || !SAFE_MODEL_QUALIFIER_RE.test(qualifier)) continue;
    // A suffix that is ITSELF a known model spelling is a second model, not a
    // qualifier — "D-Max TFR" must not resolve to D-Max by swallowing the real
    // Isuzu TFR. Self-maintaining: a model added to master data later is
    // protected automatically, with no edit to MODEL_GENERATION_CODES.
    if (lookup.has(normalizeModelSpelling(qualifier))) continue;
    // Prefer the most-specific spelling. The live master data legitimately has
    // generic models named "Mazda" / "MG" as well as "Mazda 3" / "MG 3".
    // Without maximal matching, "Mazda 3 2.0" yields two valid prefixes
    // (Mazda + "3 2.0", Mazda 3 + "2.0") and resolves to neither.
    if (normalizedSpelling.length < longestMatchedSpelling) continue;
    if (normalizedSpelling.length > longestMatchedSpelling) {
      matches.clear();
      longestMatchedSpelling = normalizedSpelling.length;
    }
    matches.set(canonicalModel.toLowerCase(), qualifier);
  }

  if (matches.size !== 1) return null;
  const [canonicalKey, qualifier] = matches.entries().next().value as [string, string];
  // Recover canonical casing from the matched cluster rather than returning the
  // lowercased map key.
  const canonicalModel = Array.from(lookup.values())
    .map((cluster) => cluster[0]?.trim())
    .find((term) => term?.toLowerCase() === canonicalKey);
  return canonicalModel ? { canonicalModel, qualifier } : null;
}

type HardModelAliasRule = {
  brandName: string;
  modelName: string;
  aliases: string[];
  brandScopes?: string[];
  requiresHiluxContext?: boolean;
};

const HARD_MODEL_ALIAS_RULES: HardModelAliasRule[] = [
  {
    brandName: "Isuzu",
    modelName: "D-Max",
    brandScopes: ["isuzu", "อีซูซุ", "อีซูสุ", "อิซูซุ", "อิซูสุ"],
    aliases: [
      "ออนิว",
      "ออลนิว",
      "allnew",
      "allnewdmax",
      "allnewd-max",
      "ออนิวดีแม็ก",
      "ออนิวดีแมค",
      "ดีแม็กออนิว",
      "ดีแมคออนิว",
      "allnewdmax",
      "dmaxallnew",
      "d-maxallnew",
      "vcross",
      "วีครอส",
      "hilander",
      "ไฮแลนเดอร์",
    ],
  },
  {
    brandName: "Toyota",
    modelName: "Hilux Revo",
    brandScopes: ["toyota", "โตโยต้า", "โตโยตา"],
    aliases: ["revo", "รีโว่", "รีโว", "รีโว้", "hiluxrevo", "rocco", "ร็อคโค่", "ร็อคโค", "รอคโค", "grsport", "gr-s", "จีอาร์สปอร์ต"],
  },
  {
    brandName: "Toyota",
    modelName: "Hilux Vigo",
    brandScopes: ["toyota", "โตโยต้า", "โตโยตา"],
    aliases: ["vigo", "วีโก้", "วีโก", "hiluxvigo", "vigochamp", "วีโก้แชมป์", "วีโกแชมป์"],
  },
  {
    brandName: "Toyota",
    modelName: "Hilux Mighty-X",
    brandScopes: ["toyota", "โตโยต้า", "โตโยตา"],
    aliases: ["mightyx", "mightyx", "ไมตี้เอ็กซ์", "ไมตี้เอ๊กซ์", "ไมตี้x", "hiluxmightyx"],
  },
  {
    brandName: "Toyota",
    modelName: "Hilux Champ",
    brandScopes: ["toyota", "โตโยต้า", "โตโยตา"],
    aliases: ["hiluxchamp", "ไฮลักซ์แชมป์", "imv0", "imv 0"],
  },
  {
    brandName: "Nissan",
    modelName: "NP300",
    brandScopes: ["nissan", "นิสสัน", "นิสัน", "นิสสน"],
    aliases: ["np300", "np 300", "เอ็นพี300", "เอ็นพี 300", "เอ็นพีสามร้อย", "np300navara"],
  },
  {
    brandName: "Nissan",
    modelName: "Frontier",
    brandScopes: ["nissan", "นิสสัน", "นิสัน", "นิสสน"],
    aliases: ["frontier", "ฟรอนเทียร์", "ฟรอนเทีย", "ฟ้อนเทีย", "frontiernavara"],
  },
  {
    brandName: "Ford",
    modelName: "Ranger",
    brandScopes: ["ford", "ฟอร์ด"],
    aliases: ["wildtrak", "ไวลด์แทรค", "raptor", "แรพเตอร์", "แร็พเตอร์", "rangerraptor"],
  },
];

const HARD_MODEL_ALIAS_BY_VALUE = new Map<string, HardModelAliasRule>(
  HARD_MODEL_ALIAS_RULES.flatMap((rule) => rule.aliases.map((alias) => [normalizeAliasText(alias), rule] as const)),
);

const includesHiluxContext = (values: string[]) =>
  values.some((value) => value.includes("hilux") || value.includes("ไฮลัก") || value.includes("ไฮลักซ์"));

export function resolveColloquialCarModelAlias(input: {
  carBrand?: string | null;
  carModel?: string | null;
  rawText?: string | null;
}): { brandName: string; modelName: string } | null {
  const brand = normalizeAliasText(input.carBrand);
  const candidates = [input.carModel, input.rawText].map(normalizeAliasText).filter(Boolean);

  for (const candidate of candidates) {
    const rule = HARD_MODEL_ALIAS_BY_VALUE.get(candidate);
    if (!rule) continue;
    if (rule.brandScopes?.length && brand && !rule.brandScopes.includes(brand)) continue;
    if (rule.requiresHiluxContext && !includesHiluxContext(candidates)) continue;
    return { brandName: rule.brandName, modelName: rule.modelName };
  }

  return null;
}

/**
 * Shared alias lookup against the cached CategoryAlias rows. Exported so the
 * part-type conflict check can reuse the SAME cache and the SAME matcher instead
 * of issuing its own query — the check runs on every product turn.
 */
export async function matchDbCategoryAlias(texts: Array<string | null | undefined>) {
  try {
    const rows = await getCachedCategoryAliasRows(() =>
      db.categoryAlias.findMany({
        where: {
          isActive: true,
          OR: [{ kind: "SKIP_CATEGORY" }, { kind: "MATCH", category: { isActive: true } }],
        },
        select: {
          alias: true,
          kind: true,
          matchMode: true,
          priority: true,
          isActive: true,
          category: { select: { id: true, name: true, isActive: true } },
        },
      }),
    );
    return matchCategoryAliasRows(texts, rows);
  } catch {
    // Keep the legacy resolver working while the CategoryAlias table rolls out.
    return null;
  }
}

/**
 * Maps colloquial part-type words (what customers / the AI actually say) to a
 * distinctive substring of the real category name in the system, so a hard
 * category filter can be applied even when the spoken term differs from the
 * catalog category (e.g. "วาล์วแอร์" → category "วาล์ว (Expansion Valve)",
 * "คอยเย็น" → "คอยล์เย็น (Evaporator)").
 *
 * ORDER MATTERS: more specific entries come first so an ambiguous substring
 * (e.g. "วาล์ว" in both Expansion Valve and Compressor Control Valve, or
 * "หม้อน้ำ" in Radiator / Radiator Cap / Coolant) resolves to the right one.
 * The `categoryMatch` value is matched against the real category name with a
 * case-insensitive `contains`, so it stays bound to the live categories rather
 * than hardcoding the full name.
 */
type PartTypeAlias = { keywords: string[]; categoryMatch: string };
const PART_TYPE_CATEGORY_ALIASES: PartTypeAlias[] = [
  { keywords: ["คอนโทรลวาล์ว", "control valve"], categoryMatch: "Compressor Control Valve" },
  // Explicit A/C-valve terms ONLY. Bare "วาล์ว" and its misspellings "วาว์ล"/"วาวล์"
  // are intentionally NOT mapped here: a bare valve word is ambiguous (A/C expansion
  // valve vs engine water valve / thermostat), so it must resolve via an
  // admin-curated DB CategoryAlias — which takes precedence over this matcher — or,
  // when still unresolved, the chat relevance gate hands off instead of guessing.
  // (Previously assumed "no thermostat product exists → bare valve = expansion
  // valve"; removed so a new วาล์วน้ำ/Thermostat category can be added safely.)
  {
    keywords: ["วาล์วแอร์", "วาล์วตู้", "expansion valve", "วาว์ลแอร์", "วาวล์แอร์"],
    categoryMatch: "(Expansion Valve)",
  },
  { keywords: ["น้ำมันคอม", "compressor oil"], categoryMatch: "Compressor Oil" },
  { keywords: ["หน้าครัช", "หน้าคลัช", "คลัชคอม", "มูเล่คอม", "clutch"], categoryMatch: "Compressor Clutch" },
  { keywords: ["คอมแอร์", "คอมเพรสเซอร์", "compressor"], categoryMatch: "(Compressor)" },
  { keywords: ["คอยล์เย็น", "คอยเย็น", "ตู้แอร์", "ตู้เย็น", "evaporator"], categoryMatch: "(Evaporator)" },
  // Fan-blade / fan-motor entries MUST precede the generic "(Condenser)" entry
  // below. The Condenser Fan Motor category NAME itself embeds "หน้าแผงแอร์"
  // (and the word "Condenser"), so if the "แผงแอร์"/"condenser" → (Condenser) rule
  // ran first it would mis-route a fan-motor part to the แผงแอร์ (Condenser)
  // category — the exact bug seen with partType = the full canonical category name.
  // Matching is first-hit by substring, so the more specific fan entries win here.
  { keywords: ["ใบพัดลม", "ใบพัด", "fan blade"], categoryMatch: "Cooling Fan Blade" },
  {
    keywords: ["มอเตอร์พัดลม", "พัดลมหน้าแผง", "พัดลมหม้อน้ำ", "พัดลมหน้าเครื่อง", "condenser fan"],
    categoryMatch: "Condenser Fan Motor",
  },
  { keywords: ["คอยล์ร้อน", "แผงแอร์", "แผงร้อน", "รังผึ้งแอร์", "condenser"], categoryMatch: "(Condenser)" },
  { keywords: ["กรองแอร์", "ฟิลเตอร์แอร์", "cabin"], categoryMatch: "Cabin air filter" },
  { keywords: ["กรองอากาศ", "ไส้กรองอากาศ", "air filter"], categoryMatch: "(Air Filter)" },
  { keywords: ["ดรายเออร์", "ไดเออร์", "ไดรเออร์", "drier", "receiver"], categoryMatch: "Drier" },
  { keywords: ["รีซิสเตอร์", "resistor"], categoryMatch: "Blower Motor Resistor" },
  { keywords: ["โบเวอร์", "พัดลมแอร์", "มอเตอร์ตู้แอร์", "พัดลมตู้แอร์", "blower"], categoryMatch: "Blower Motor)" },
  { keywords: ["ฝาหม้อน้ำ", "ฝาปิดหม้อน้ำ", "radiator cap"], categoryMatch: "Radiator Cap" },
  { keywords: ["น้ำยาหล่อเย็น", "คูลแลนท์", "coolant"], categoryMatch: "Radiator Coolant" },
  { keywords: ["สายน้ำยา", "ท่อน้ำยา", "a/c hose"], categoryMatch: "A/C Hose" },
  { keywords: ["ท่อยางหม้อน้ำ", "ท่อน้ำหม้อน้ำ", "radiator hose"], categoryMatch: "Radiator Hose" },
  { keywords: ["หม้อน้ำ", "radiator"], categoryMatch: "(Radiator)" },
];

/**
 * Accessory / chemical / tool intents that live in the generic "อะไหล่อื่นๆ"
 * junk-drawer category (no dedicated part category). Their NAMES embed a part
 * keyword as a substring by nature — a cleaner is "ล้าง + [the part it cleans]",
 * a valve cap is "ฝาปิด + วาล์ว" — so the substring matcher below would wrongly
 * force them into the part's category (e.g. "น้ำยาล้างคอยเย็น" → Evaporator),
 * a HARD filter that then excludes the actual product. When the query/part-type
 * matches one of these, we skip the category hint entirely and let the free-text
 * search find the item (brand/model filters are still applied).
 *
 * Keep entries SPECIFIC enough not to collide with a legit part category
 * (e.g. "ฝาปิดกล่องกรอง" not bare "ฝา"; "วาล์วลูกศร" not bare "วาล์ว").
 */
const ACCESSORY_CHEMICAL_SKIP_KEYWORDS = [
  // Cleaners / flush chemicals (coil cleaner, condenser cleaner, system flush)
  "น้ำยาล้าง",
  "น้ำยาไล่",
  "ล้างคอย",
  "ล้างแผง",
  "ล้างระบบแอร์",
  "coil cleaner",
  "condenser cleaner",
  // Seals / tapes / fasteners / o-rings
  "ฟองน้ำ",
  "เทป",
  "น็อต",
  "น๊อต",
  "โอริง",
  "o-ring",
  "oring",
  // Box covers / valve caps (NOT the filter / valve itself)
  "ฝาปิดกล่องกรอง",
  "ฝาปิดวาล์ว",
  // Tools & charging fittings / schrader valve cores
  "เครื่องมือ",
  "ตัวถอด",
  "วาล์วลูกศร",
  "ไส้ศร",
  "หัวคอปเปอร์",
  "หัวเติม",
];

/**
 * True when the text indicates an accessory / chemical / tool (junk-drawer)
 * product whose name embeds a part keyword — so the part-category hard filter
 * must be skipped. Pure + exported for unit testing.
 */
export const isAccessoryOrChemicalIntent = (text: string | null | undefined): boolean => {
  const t = text?.trim().toLowerCase();
  if (!t) return false;
  return ACCESSORY_CHEMICAL_SKIP_KEYWORDS.some((keyword) => t.includes(keyword.toLowerCase()));
};

/**
 * Returns the distinctive category-name substring for a colloquial part-type, or
 * null when none matches. Pure + exported for unit testing.
 */
export const matchPartTypeToCategoryHint = (partType: string | null | undefined): string | null => {
  const p = partType?.trim().toLowerCase();
  if (!p) return null;
  // Accessory / chemical intents must never resolve to a part category.
  if (isAccessoryOrChemicalIntent(p)) return null;
  for (const alias of PART_TYPE_CATEGORY_ALIASES) {
    if (alias.keywords.some((keyword) => p.includes(keyword.toLowerCase()))) {
      return alias.categoryMatch;
    }
  }
  return null;
};

/** Head nouns that make the customer's subject a FAN rather than a panel. */
const FAN_HEAD_NOUN_RE = /(?:พัดลม|ใบพัด|\bfan\b)/iu;
/** Category names that already name a fan — those aliases are never overridden. */
const FAN_CATEGORY_NAME_RE = /(?:พัดลม|ใบพัด|fan)/iu;

/**
 * True when the customer LED with a fan head noun and the winning alias points at
 * a NON-fan category that appears LATER in the same text — i.e. the alias is the
 * modifier, not the subject: "พัดลม10 24โว้นแผงคอยร้อน" is the condenser's fan,
 * not a condenser. Letting that alias stand turns the search into a hard filter on
 * the wrong category (the แผงแอร์ answer seen in production on 2026-08-17), so the
 * caller drops it and lets the spec / part-type path decide instead.
 *
 * Position is what separates the two readings, so it is checked explicitly:
 * "แผงแอร์กับพัดลม" names the panel FIRST, so there the alias IS the subject and
 * keeps winning. Only the customer's own words are searched (raw + consolidated
 * query); when the alias matched solely via the AI-rewritten `partType` it is not
 * found here and the alias stands unchanged.
 *
 * Pure + exported for unit testing.
 */
export const fanHeadNounOutranksAlias = (
  customerText: string | null | undefined,
  alias: string | null | undefined,
  categoryName: string | null | undefined,
): boolean => {
  const haystack = customerText?.toLowerCase() ?? "";
  const needle = alias?.trim().toLowerCase() ?? "";
  if (!haystack || !needle) return false;
  if (FAN_CATEGORY_NAME_RE.test(categoryName ?? "")) return false;
  const fanAt = haystack.search(FAN_HEAD_NOUN_RE);
  if (fanAt < 0) return false;
  const aliasAt = haystack.indexOf(needle);
  return aliasAt > fanAt;
};

/**
 * Resolves a car model name to its brand when the name UNAMBIGUOUSLY identifies a
 * single active model in the catalog (exact, case-insensitive). Returns null when
 * the name is unknown or shared across brands (e.g. "2", "City") — callers must
 * never let an ambiguous model hijack the brand. Used to correct a wrong/missing
 * brand from the model (e.g. carried-over "Toyota" + "D-Max" → Isuzu).
 */
async function resolveModelExact(
  carModel: string,
): Promise<{ brandName: string; modelName: string } | null> {
  const rows = await db.carModel.findMany({
    where: {
      isActive: true,
      name: { equals: carModel, mode: "insensitive" },
      carBrand: { isActive: true },
    },
    select: { name: true, carBrand: { select: { name: true } } },
    take: 2,
  });
  if (rows.length !== 1) return null;
  return { brandName: rows[0].carBrand.name, modelName: rows[0].name };
}

/**
 * Case-insensitive resolution against CarBrand / CarModel / Category. Prefers an
 * exact (insensitive) name match; for car models, scopes to the resolved brand and
 * falls back to a `contains` match (e.g. AI "Mazda 2" vs master "2").
 */
export async function resolveChatFitmentFilters(
  input: ChatFitmentFilterInput,
): Promise<ChatFitmentFilters> {
  const carBrand = trimOrNull(input.carBrand);
  const carModel = trimOrNull(input.carModel);
  const partType = trimOrNull(input.partType);
  const queryText = trimOrNull(input.queryText);
  const rawText = trimOrNull(input.rawText);
  const modelLookup: ReadonlyMap<string, string[]> =
    input.modelLookup ?? (await loadCarModelVariantLookup().catch((): CarModelVariantLookup => new Map()));
  const canonicalModelHint = resolveCanonicalCarModelHint(carModel, modelLookup);
  const carModelForResolution = canonicalModelHint?.canonicalModel ?? carModel;

  const filters: ChatFitmentFilters = {};
  const colloquialModel = resolveColloquialCarModelAlias({
    carBrand,
    carModel,
    rawText: [rawText, queryText].filter(Boolean).join(" "),
  });
  if (colloquialModel) {
    filters.carBrandName = colloquialModel.brandName;
    filters.carModelName = colloquialModel.modelName;
  }
  // Include the raw customer text so a precise spoken keyword still resolves even
  // when the AI's partType/consolidated query dropped or rewrote it.
  const aliasMatch = await matchDbCategoryAlias([partType, queryText, rawText]);

  // Skip the part-category hard filter for accessory/chemical intents. Checked
  // against BOTH partType AND the full query text, so it triggers even when the
  // AI shortened partType to a bare part keyword ("คอยเย็น") while the customer
  // text ("น้ำยาล้างคอยเย็น") clearly indicates a cleaner. Brand/model below are
  // unaffected.
  const skipCategory =
    aliasMatch?.kind === "SKIP_CATEGORY" ||
    isAccessoryOrChemicalIntent([partType, queryText, rawText].filter(Boolean).join(" "));

  // Prefer the colloquial→category alias (e.g. "วาล์วแอร์" → "(Expansion Valve)");
  // fall back to a direct equals/contains on the spoken part-type.
  // A fan head noun the customer typed BEFORE the alias outranks it — see
  // `fanHeadNounOutranksAlias`. Dropping the alias here also re-enables the
  // part-type lookup below, so the fan spec/part-type path gets to decide.
  const aliasOutrankedByFanHeadNoun =
    aliasMatch?.kind === "MATCH" &&
    fanHeadNounOutranksAlias(
      [rawText, queryText].filter(Boolean).join(" "),
      aliasMatch.alias,
      aliasMatch.categoryName,
    );
  const categoryFromAlias =
    aliasMatch?.kind === "MATCH" && !aliasOutrankedByFanHeadNoun ? aliasMatch.categoryName : null;
  const contextualCategoryHint = resolveChatProductSpecs(
    [rawText, queryText, partType].filter(Boolean).join(" "),
  ).categoryHint;
  const categoryHint =
    skipCategory || categoryFromAlias
      ? null
      : contextualCategoryHint ?? matchPartTypeToCategoryHint(partType);
  const allowPartTypeCategoryLookup = !skipCategory && !categoryFromAlias && Boolean(partType);

  try {
    const [brandRow, exactCategoryRow, categoryRow] = await Promise.all([
      carBrand
        ? db.carBrand.findFirst({
            where: { isActive: true, name: { equals: carBrand, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      // Option B — highest-precedence path: when `partType` is ALREADY the exact
      // canonical name of an active category, trust it verbatim and NEVER run it
      // through the colloquial substring matcher. A prior frame / known-intent can
      // store the full category name as partType (e.g. "…หน้าแผงแอร์ (Condenser Fan
      // Motor)"), and that name embeds "แผงแอร์"/"condenser" — which the fuzzy
      // matcher would mis-route to the (Condenser) category. Exact match kills that.
      partType
        ? db.category.findFirst({
            where: { isActive: true, name: { equals: partType, mode: "insensitive" } },
            select: { name: true },
          })
        : Promise.resolve(null),
      categoryHint
        ? db.category.findMany({
            where: { isActive: true, name: { contains: categoryHint, mode: "insensitive" } },
            select: { name: true },
            take: 2,
          })
        : allowPartTypeCategoryLookup && partType
        ? db.category.findMany({
            where: {
              isActive: true,
              OR: [
                { name: { equals: partType, mode: "insensitive" } },
                { name: { contains: partType, mode: "insensitive" } },
              ],
            },
            select: { name: true },
            take: 2,
          })
        : Promise.resolve([]),
    ]);

    // Precedence: exact category name (partType == a real category) wins over the
    // colloquial alias, which wins over the fuzzy hint / contains lookup.
    if (exactCategoryRow) filters.categoryName = exactCategoryRow.name;
    else if (categoryFromAlias) filters.categoryName = categoryFromAlias;
    // A bare part word such as "พัดลม" can match several live categories. Only a
    // unique fuzzy candidate is safe enough to become a hard category filter.
    else if (categoryRow.length === 1) filters.categoryName = categoryRow[0].name;
    if (!filters.carBrandName && brandRow) filters.carBrandName = brandRow.name;

    // Car model resolution. Model names like "2" / "City" are ambiguous across
    // brands, so when a brand is known we scope to it (exact then contains).
    if (filters.carModelName) {
      return filters;
    }

    if (brandRow && carModelForResolution) {
      const modelRow =
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { equals: carModelForResolution, mode: "insensitive" },
          },
          select: { name: true },
        })) ??
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { contains: carModelForResolution, mode: "insensitive" },
          },
          select: { name: true },
        }));
      if (modelRow) {
        filters.carModelName = modelRow.name;
        if (canonicalModelHint) {
          filters.carModelOriginal = carModel ?? undefined;
          filters.carModelQualifier = canonicalModelHint.qualifier ?? undefined;
          filters.carModelResolutionSource = "search_synonym";
        }
      } else {
        // Cross-brand correction: the brand resolved (e.g. carried-over "Toyota")
        // but the model does NOT belong to it. The model is the more specific
        // signal — if it EXACTLY (case-insensitive) names exactly one active model
        // in the catalog, trust the model and override the brand to the model's
        // real brand (e.g. "Toyota" + "D-Max" → Isuzu D-Max). Exact-only keeps
        // ambiguous short names ("2", "City") from hijacking the brand.
        const corrected = await resolveModelExact(carModelForResolution);
        if (corrected) {
          filters.carBrandName = corrected.brandName;
          filters.carModelName = corrected.modelName;
          if (canonicalModelHint) {
            filters.carModelOriginal = carModel ?? undefined;
            filters.carModelQualifier = canonicalModelHint.qualifier ?? undefined;
            filters.carModelResolutionSource = "search_synonym";
          }
        }
      }
    } else if (!brandRow && carModelForResolution) {
      // No brand given (customer typed only a model, e.g. "คอมแอร์ Mu-x"). Resolve
      // the brand FROM the model when it is unambiguous.
      const corrected = await resolveModelExact(carModelForResolution);
      if (corrected) {
        filters.carBrandName = corrected.brandName;
        filters.carModelName = corrected.modelName;
        if (canonicalModelHint) {
          filters.carModelOriginal = carModel ?? undefined;
          filters.carModelQualifier = canonicalModelHint.qualifier ?? undefined;
          filters.carModelResolutionSource = "search_synonym";
        }
      }
    }
  } catch {
    // Resolution is best-effort precision; never block search on a lookup failure.
    return {};
  }

  return filters;
}
