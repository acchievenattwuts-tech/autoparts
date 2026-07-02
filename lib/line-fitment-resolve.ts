import { db } from "@/lib/db";
import { getCachedCategoryAliasRows } from "@/lib/category-alias-cache";
import { matchCategoryAliasRows } from "@/lib/category-alias-resolver";

/**
 * Resolves the AI-extracted fitment hints (free-text brand/model/part type) to the
 * EXACT canonical names stored in master data, so they can be used as hard filters
 * in product search (which match by exact name `IN (...)`).
 *
 * Safety-first: a hint becomes a hard filter ONLY when it resolves to a real,
 * active master row. An unresolved hint is dropped (left to the free-text query),
 * so a typo or an unknown brand can never zero-out an otherwise valid search.
 */

export type LineFitmentFilterInput = {
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
};

export type LineFitmentFilters = {
  categoryName?: string;
  carBrandName?: string;
  carModelName?: string;
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

async function matchDbCategoryAlias(texts: Array<string | null | undefined>) {
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
  { keywords: ["วาล์วแอร์", "วาล์วตู้", "expansion valve", "วาล์ว"], categoryMatch: "(Expansion Valve)" },
  { keywords: ["น้ำมันคอม", "compressor oil"], categoryMatch: "Compressor Oil" },
  { keywords: ["หน้าครัช", "หน้าคลัช", "คลัชคอม", "มูเล่คอม", "clutch"], categoryMatch: "Compressor Clutch" },
  { keywords: ["คอมแอร์", "คอมเพรสเซอร์", "compressor"], categoryMatch: "(Compressor)" },
  { keywords: ["คอยล์เย็น", "คอยเย็น", "ตู้แอร์", "ตู้เย็น", "evaporator"], categoryMatch: "(Evaporator)" },
  { keywords: ["คอยล์ร้อน", "แผงแอร์", "แผงร้อน", "รังผึ้งแอร์", "condenser"], categoryMatch: "(Condenser)" },
  { keywords: ["กรองแอร์", "ฟิลเตอร์แอร์", "cabin"], categoryMatch: "Cabin air filter" },
  { keywords: ["กรองอากาศ", "ไส้กรองอากาศ", "air filter"], categoryMatch: "(Air Filter)" },
  { keywords: ["ดรายเออร์", "ไดเออร์", "drier", "receiver"], categoryMatch: "Drier" },
  { keywords: ["รีซิสเตอร์", "resistor"], categoryMatch: "Blower Motor Resistor" },
  { keywords: ["โบเวอร์", "พัดลมแอร์", "มอเตอร์ตู้แอร์", "พัดลมตู้แอร์", "blower"], categoryMatch: "Blower Motor)" },
  {
    keywords: ["มอเตอร์พัดลม", "พัดลมหน้าแผง", "พัดลมหม้อน้ำ", "พัดลมหน้าเครื่อง", "condenser fan"],
    categoryMatch: "Condenser Fan Motor",
  },
  { keywords: ["ใบพัดลม", "ใบพัด", "fan blade"], categoryMatch: "Cooling Fan Blade" },
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
export async function resolveLineFitmentFilters(
  input: LineFitmentFilterInput,
): Promise<LineFitmentFilters> {
  const carBrand = trimOrNull(input.carBrand);
  const carModel = trimOrNull(input.carModel);
  const partType = trimOrNull(input.partType);
  const queryText = trimOrNull(input.queryText);
  const rawText = trimOrNull(input.rawText);

  const filters: LineFitmentFilters = {};
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
  const categoryFromAlias = aliasMatch?.kind === "MATCH" ? aliasMatch.categoryName : null;
  const categoryHint = skipCategory || categoryFromAlias ? null : matchPartTypeToCategoryHint(partType);
  const allowPartTypeCategoryLookup = !skipCategory && !categoryFromAlias && Boolean(partType);

  try {
    const [brandRow, categoryRow] = await Promise.all([
      carBrand
        ? db.carBrand.findFirst({
            where: { isActive: true, name: { equals: carBrand, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      categoryHint
        ? db.category.findFirst({
            where: { isActive: true, name: { contains: categoryHint, mode: "insensitive" } },
            select: { name: true },
          })
        : allowPartTypeCategoryLookup && partType
        ? db.category.findFirst({
            where: {
              isActive: true,
              OR: [
                { name: { equals: partType, mode: "insensitive" } },
                { name: { contains: partType, mode: "insensitive" } },
              ],
            },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    if (categoryFromAlias) filters.categoryName = categoryFromAlias;
    else if (categoryRow) filters.categoryName = categoryRow.name;
    if (!filters.carBrandName && brandRow) filters.carBrandName = brandRow.name;

    // Car model resolution. Model names like "2" / "City" are ambiguous across
    // brands, so when a brand is known we scope to it (exact then contains).
    if (filters.carModelName) {
      return filters;
    }

    if (brandRow && carModel) {
      const modelRow =
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { equals: carModel, mode: "insensitive" },
          },
          select: { name: true },
        })) ??
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { contains: carModel, mode: "insensitive" },
          },
          select: { name: true },
        }));
      if (modelRow) {
        filters.carModelName = modelRow.name;
      } else {
        // Cross-brand correction: the brand resolved (e.g. carried-over "Toyota")
        // but the model does NOT belong to it. The model is the more specific
        // signal — if it EXACTLY (case-insensitive) names exactly one active model
        // in the catalog, trust the model and override the brand to the model's
        // real brand (e.g. "Toyota" + "D-Max" → Isuzu D-Max). Exact-only keeps
        // ambiguous short names ("2", "City") from hijacking the brand.
        const corrected = await resolveModelExact(carModel);
        if (corrected) {
          filters.carBrandName = corrected.brandName;
          filters.carModelName = corrected.modelName;
        }
      }
    } else if (!brandRow && carModel) {
      // No brand given (customer typed only a model, e.g. "คอมแอร์ Mu-x"). Resolve
      // the brand FROM the model when it is unambiguous.
      const corrected = await resolveModelExact(carModel);
      if (corrected) {
        filters.carBrandName = corrected.brandName;
        filters.carModelName = corrected.modelName;
      }
    }
  } catch {
    // Resolution is best-effort precision; never block search on a lookup failure.
    return {};
  }

  return filters;
}
