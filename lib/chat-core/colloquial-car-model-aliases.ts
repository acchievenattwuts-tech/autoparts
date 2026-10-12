/**
 * Colloquial car-model names customers type instead of the catalog name
 * ("all new" / "ออนิว" → Isuzu D-Max, "วีโก้" → Toyota Hilux Vigo). Pure and
 * dependency-free, so both the DB-backed fitment resolver and the deterministic
 * price-subject fallback (which runs when the Gemini classifier is unavailable)
 * read the SAME table.
 *
 * Owner decision 2026-10-12: a bare "all new" always means Isuzu D-Max. An alias
 * stays out of scope when the customer names a different brand ("toyota all new").
 */

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

/** One car model named in free text, located by {@link findColloquialCarModelMentions}. */
export type ColloquialCarModelMention = {
  brandName: string;
  modelName: string;
  /** Spellings of the model's own brand (from the alias table), lowercased. */
  brandScopes: string[];
  /** The customer's own words, sliced from the scanned text (e.g. "all new"). */
  matchedText: string;
  /** True when the customer typed the catalog name itself ("d-max"), not a nickname. */
  viaCanonicalName: boolean;
  start: number;
  end: number;
};

type MentionPattern = {
  rule: HardModelAliasRule;
  viaCanonicalName: boolean;
  regex: RegExp;
};

const LATIN_OR_DIGIT_RE = /[a-z0-9]/;
const escapeRegexChar = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds a matcher for one alias. Separators are optional between every
 * character, so "allnew" also finds "all new" / "all-new". Latin edges need a
 * word boundary ("revo" must not match inside "revolution"); Thai edges do not,
 * because Thai is written without spaces ("ตู้แอร์วีโก้ราคา").
 */
function buildMentionRegex(compactAlias: string): RegExp {
  const chars = Array.from(compactAlias);
  const body = chars.map(escapeRegexChar).join("[\\s_-]*");
  const head = LATIN_OR_DIGIT_RE.test(chars[0] ?? "") ? "(?<![a-z0-9])" : "";
  const tail = LATIN_OR_DIGIT_RE.test(chars[chars.length - 1] ?? "") ? "(?![a-z0-9])" : "";
  return new RegExp(`${head}${body}${tail}`, "giu");
}

const MENTION_PATTERNS: MentionPattern[] = HARD_MODEL_ALIAS_RULES.flatMap((rule) => {
  const aliasPatterns = Array.from(new Set(rule.aliases.map(normalizeAliasText)))
    .filter(Boolean)
    .map((alias) => ({ rule, viaCanonicalName: false, regex: buildMentionRegex(alias) }));
  const canonical = normalizeAliasText(rule.modelName);
  const canonicalPatterns = rule.aliases.map(normalizeAliasText).includes(canonical)
    ? []
    : [{ rule, viaCanonicalName: true, regex: buildMentionRegex(canonical) }];
  return [...aliasPatterns, ...canonicalPatterns];
});

/**
 * Finds every car model from the alias table that the text names, longest
 * match first and without overlaps ("all new d-max" is one mention, not two).
 * The caller decides what several DIFFERENT models in one message mean.
 */
export function findColloquialCarModelMentions(text?: string | null): ColloquialCarModelMention[] {
  const haystack = (text ?? "").toLowerCase();
  if (!haystack.trim()) return [];

  const sameLength = haystack.length === (text ?? "").length;
  const candidates: ColloquialCarModelMention[] = [];
  for (const pattern of MENTION_PATTERNS) {
    for (const match of haystack.matchAll(pattern.regex)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      candidates.push({
        brandName: pattern.rule.brandName,
        modelName: pattern.rule.modelName,
        brandScopes: (pattern.rule.brandScopes ?? []).map((scope) => scope.toLowerCase()),
        // toLowerCase keeps Thai/ASCII lengths, so the span maps back onto the
        // original casing ("All New"); fall back to the lowercased copy otherwise.
        matchedText: (sameLength ? (text ?? "") : haystack).slice(start, end),
        viaCanonicalName: pattern.viaCanonicalName,
        start,
        end,
      });
    }
  }

  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: ColloquialCarModelMention[] = [];
  for (const candidate of candidates) {
    if (kept.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
    kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start);
}
