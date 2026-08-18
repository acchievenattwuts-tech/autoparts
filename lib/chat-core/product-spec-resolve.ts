export const COOLING_FAN_BLADE_CATEGORY_HINT = "Cooling Fan Blade";
export const BLOWER_MOTOR_CATEGORY_HINT = "Blower Motor)";
export const CONDENSER_FAN_MOTOR_CATEGORY_HINT = "Condenser Fan Motor";

/**
 * Categories whose products carry NO vehicle fitment rows at all, verified
 * against the live catalog (2026-08-17): a universal fan blade, compressor oil,
 * and radiator coolant fit anything, so nobody ever tags them to a car.
 *
 * A brand/model filter can therefore only ever SUBTRACT from these — measured:
 * every one of them returns 0 the moment any car is applied. That makes the
 * vehicle scope meaningless here, which is what licenses the search bridge to
 * drop it on an empty result.
 *
 * Deliberately a fixed list rather than the classifier's `partKind`, which is an
 * LLM field this codebase has never logged or measured. These three reflect what
 * the PRODUCT is, not how completely its fitment data happens to be filled in —
 * and the golden suite asserts they still have zero fitment rows, so the day the
 * shop tags one of them the test fails instead of the customer.
 */
export const VEHICLE_FREE_CATEGORY_HINTS = [
  COOLING_FAN_BLADE_CATEGORY_HINT,
  "Compressor Oil",
  "Radiator Coolant",
] as const;

/**
 * True when a RESOLVED category name belongs to a vehicle-free category. Matches
 * on the distinctive English fragment the catalog names embed, e.g.
 * "ใบพัดลม (Cooling Fan Blade)". Pure + exported for unit testing.
 */
export const isVehicleFreeChatCategory = (categoryName: string | null | undefined): boolean => {
  const name = categoryName?.toLowerCase() ?? "";
  if (!name) return false;
  return VEHICLE_FREE_CATEGORY_HINTS.some((hint) => name.includes(hint.toLowerCase()));
};

export type ChatFanDirection = "push" | "pull";
export type ChatProductVoltage = 12 | 24;

export type ChatProductSpecs = {
  categoryHint: string | null;
  diameterInches: number | null;
  fanDirection: ChatFanDirection | null;
  voltage: number | null;
};

export type ChatProductIdentityConstraint = {
  /** Stable diagnostic key; never derived from an LLM. */
  key: string;
  /** Exact customer evidence that caused this constraint to be applied. */
  evidence: string;
  /** AND between constraints, OR between these catalog spelling variants. */
  variants: string[];
};

const NUMBERED_PHYSICAL_FEATURE_RE =
  /(?:^|[\s(])([1-9]\d?)\s*(หาง|รู|ขา|สาย|พิน|pins?)(?=$|[\s),./-])/giu;

const PHYSICAL_FEATURE_VARIANTS: Readonly<Record<string, { th: string; en: string }>> = {
  หาง: { th: "หาง", en: "tail" },
  รู: { th: "รู", en: "hole" },
  ขา: { th: "ขา", en: "pin" },
  สาย: { th: "สาย", en: "wire" },
  พิน: { th: "พิน", en: "pin" },
  pin: { th: "พิน", en: "pin" },
  pins: { th: "พิน", en: "pin" },
};

const CONNECTOR_SHAPE_CONSTRAINTS: ReadonlyArray<{
  key: string;
  pattern: RegExp;
  variants: string[];
}> = [
  {
    key: "connector:taper",
    pattern: /(?:หัว\s*)?(?:taper|เตเปอร์|เทเปอร์)/iu,
    variants: ["taper", "หัว taper", "หัวtaper", "เตเปอร์", "หัวเตเปอร์", "เทเปอร์", "หัวเทเปอร์"],
  },
  {
    key: "connector:flare",
    pattern: /(?:หัว\s*)?(?:flare|แฟร์|แฟลร์)/iu,
    variants: ["flare", "หัว flare", "หัวflare", "แฟร์", "หัวแฟร์", "แฟลร์", "หัวแฟลร์"],
  },
];

const buildNumberedFeatureVariants = (count: number, feature: { th: string; en: string }): string[] => {
  const variants = [
    `${count} ${feature.th}`,
    `${count}${feature.th}`,
    `${count} ${feature.en}`,
    `${count}${feature.en}`,
  ];
  if (count === 1) {
    variants.push(
      `${feature.th}เดียว`,
      `single ${feature.en}`,
      `one ${feature.en}`,
    );
  }
  return variants;
};

/**
 * Extracts only high-confidence physical identity phrases that are useful across
 * product categories. Bare numbers and vague adjectives are deliberately ignored:
 * "No80" / "ธรรมดา" may be shop/customer shorthand and must not become a hard
 * product fact without catalog evidence. Every returned value is grounded in an
 * exact regex match from the customer's text; no AI-generated constraints enter
 * this path.
 */
export function extractChatProductIdentityConstraints(
  value: string | null | undefined,
): ChatProductIdentityConstraint[] {
  const text = value?.trim() ?? "";
  if (!text) return [];

  const constraints: ChatProductIdentityConstraint[] = [];
  const seenKeys = new Set<string>();

  for (const match of text.matchAll(NUMBERED_PHYSICAL_FEATURE_RE)) {
    const count = Number(match[1]);
    const rawFeature = match[2]?.toLowerCase();
    const feature = rawFeature ? PHYSICAL_FEATURE_VARIANTS[rawFeature] : null;
    if (!feature || !Number.isInteger(count) || count <= 0) continue;
    const key = `count:${feature.en}:${count}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    constraints.push({
      key,
      evidence: match[0].trim(),
      variants: buildNumberedFeatureVariants(count, feature),
    });
  }

  for (const shape of CONNECTOR_SHAPE_CONSTRAINTS) {
    const match = text.match(shape.pattern);
    if (!match || seenKeys.has(shape.key)) continue;
    seenKeys.add(shape.key);
    constraints.push({
      key: shape.key,
      evidence: match[0].trim(),
      variants: shape.variants,
    });
  }

  return constraints;
}

export function buildChatProductIdentityRequiredTokenGroups(
  value: string | null | undefined,
): string[][] {
  return extractChatProductIdentityConstraints(value).map((constraint) => constraint.variants);
}

const BLOWER_CONTEXT_RE =
  /(?:โบล?เวอร์|blower|พัดลม\s*แอร์|พัดลม\s*(?:เป่า\s*)?ตู้แอร์|มอเตอร์\s*ตู้แอร์|พัดลม\s*เป่า\s*คอยล์เย็น)/iu;
const FAN_MOTOR_CONTEXT_RE =
  /(?:มอเตอร์\s*พัดลม|มอเตอร์\s*เป่า\s*แผง|พัดลม\s*หน้า(?:แผง|เครื่อง)|พัดลม\s*หม้อน้ำ|condenser\s+fan(?:\s+motor)?)/iu;
const FAN_BLADE_CONTEXT_RE = /(?:ใบ\s*พัดลม|ใบพัด|fan\s*blade)/iu;
const PUSH_FAN_RE = /(?:พัดลม\s*(?:แบบ\s*)?เป่า|แบบ\s*เป่า|push(?:er)?\s*fan|fan\s*push)/iu;
const PULL_FAN_RE = /(?:พัดลม\s*(?:แบบ\s*)?ดูด|แบบ\s*ดูด|pull(?:er)?\s*fan|fan\s*pull|suction\s*fan)/iu;
const FAN_CONTEXT_RE = /(?:พัดลม|ใบพัด|\bfan\b)/iu;

/**
 * Thai spellings of "โวลต์" that real customers type. Curated, never fuzzy — the
 * same approach as the existing "blower moter" alias — so a mis-keyed unit still
 * grounds the voltage while an unrelated word can never become a hard filter.
 * Seen in production: "พัดลม10 24โว้นแผงคอยร้อน" (LINE, 2026-08-17).
 * Longest spellings first so alternation cannot match a shorter prefix.
 */
const VOLT_UNIT_VARIANTS = [
  "โวลต์",
  "โวลท์",
  "โวล์ท",
  "โวลต",
  "โวลท",
  "โว้น",
  "โวน",
  "โวล",
] as const;

const VOLT_UNIT_PATTERN = `v(?:olt)?s?|${VOLT_UNIT_VARIANTS.join("|")}`;

/**
 * Units/counters that give a bare number a meaning OTHER than a diameter, so the
 * head-noun fallback below must not claim it: "พัดลม10ใบ" is a blade count and
 * "พัดลม 24V" is a voltage.
 */
const BARE_DIAMETER_BLOCKING_SUFFIX = [
  "ใบ",
  "ชิ้น",
  "ตัว",
  "อัน",
  "แผ่น",
  "นิ้ว",
  "มม",
  "ซม",
  "mm",
  "cm",
  "watt",
  "วัตต์",
  "w",
  "volts?",
  "v",
  "p",
  ...VOLT_UNIT_VARIANTS,
].join("|");

/**
 * A bare number counts as a diameter only when it sits IMMEDIATELY after the fan
 * head noun ("พัดลม10", "พัดลม 10"). Customers routinely drop the unit; the
 * adjacency plus the blocked suffixes keep this from swallowing a blade count, a
 * voltage, or a model year ("พัดลมรถปี 2014" — the year is not adjacent).
 */
const BARE_FAN_DIAMETER_RE = new RegExp(
  `(?:พัดลม|ใบพัด|\\bfan)\\s*(\\d{1,2})(?!\\s*(?:\\.\\d|${BARE_DIAMETER_BLOCKING_SUFFIX}))`,
  "iu",
);

/** Fan diameters this catalog family actually sells; guards the unit-less path. */
const BARE_FAN_DIAMETER_MIN_INCHES = 7;
const BARE_FAN_DIAMETER_MAX_INCHES = 20;

const extractDiameterInches = (text: string): number | null => {
  // Prefer an explicit inch unit. A bare number elsewhere in the text may be a
  // model year, blade count, product code, or voltage and must never become a
  // size hard-filter.
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:นิ้ว|inches?|in\.?|")/iu);
  if (match?.[1]) {
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 && value <= 50 ? value : null;
  }

  // Unit-less fallback, allowed only directly on the fan head noun.
  const bare = text.match(BARE_FAN_DIAMETER_RE);
  if (!bare?.[1]) return null;
  const value = Number(bare[1]);
  return Number.isInteger(value) &&
    value >= BARE_FAN_DIAMETER_MIN_INCHES &&
    value <= BARE_FAN_DIAMETER_MAX_INCHES
    ? value
    : null;
};

const VOLTAGE_RE = new RegExp(
  `(?:^|[^\\d])(12|24)\\s*(?:${VOLT_UNIT_PATTERN})(?=$|[^a-z0-9])`,
  "giu",
);

/**
 * Returns every explicit 12V/24V value grounded in the supplied text. Multiple
 * values are preserved so compatibility checks can treat a genuine "12V/24V"
 * product as supporting both, while a customer query that names both remains
 * ambiguous and does not activate a single-voltage guard.
 */
export function extractChatProductVoltages(value: string | null | undefined): ChatProductVoltage[] {
  const voltages = new Set<ChatProductVoltage>();
  for (const match of (value ?? "").matchAll(VOLTAGE_RE)) {
    const voltage = Number(match[1]);
    if (voltage === 12 || voltage === 24) voltages.add(voltage);
  }
  return Array.from(voltages);
}

export function extractChatProductVoltage(value: string | null | undefined): ChatProductVoltage | null {
  const voltages = extractChatProductVoltages(value);
  return voltages.length === 1 ? voltages[0] : null;
}

/**
 * Resolves only fan contexts that have enough customer evidence to be safe.
 * Explicit blower/fan-motor wording wins over generic push/pull wording. A fan
 * with an inch size is a universal fan blade assembly in this catalog; bare
 * "พัดลม" stays unresolved so it cannot select the first category containing
 * that word.
 */
export function resolveChatProductSpecs(value: string | null | undefined): ChatProductSpecs {
  const text = value?.trim().toLowerCase() ?? "";
  const diameterInches = extractDiameterInches(text);
  const fanDirection: ChatFanDirection | null = PUSH_FAN_RE.test(text)
    ? "push"
    : PULL_FAN_RE.test(text)
      ? "pull"
      : null;

  let categoryHint: string | null = null;
  if (FAN_BLADE_CONTEXT_RE.test(text)) {
    categoryHint = COOLING_FAN_BLADE_CATEGORY_HINT;
  } else if (BLOWER_CONTEXT_RE.test(text)) {
    categoryHint = BLOWER_MOTOR_CATEGORY_HINT;
  } else if (FAN_MOTOR_CONTEXT_RE.test(text)) {
    categoryHint = CONDENSER_FAN_MOTOR_CATEGORY_HINT;
  } else if (FAN_CONTEXT_RE.test(text) && (diameterInches !== null || fanDirection !== null)) {
    categoryHint = COOLING_FAN_BLADE_CATEGORY_HINT;
  }

  return {
    categoryHint,
    diameterInches,
    fanDirection,
    voltage: extractChatProductVoltage(text),
  };
}

const formatSpecNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");

/** AND between groups, OR between spelling variants inside one group. */
export function buildChatProductSpecRequiredTokenGroups(
  specs: ChatProductSpecs,
): string[][] {
  if (specs.categoryHint !== COOLING_FAN_BLADE_CATEGORY_HINT) return [];

  const groups: string[][] = [];
  if (specs.diameterInches !== null) {
    const size = formatSpecNumber(specs.diameterInches);
    groups.push([`${size} นิ้ว`, `${size}นิ้ว`, `${size} inch`, `${size}inch`, `${size}\"`]);
  }
  if (specs.fanDirection === "push") {
    groups.push(["แบบเป่า", "พัดลมเป่า", "push fan", "pusher fan"]);
  } else if (specs.fanDirection === "pull") {
    groups.push(["แบบดูด", "พัดลมดูด", "pull fan", "suction fan"]);
  }
  if (specs.voltage !== null) {
    groups.push([`${specs.voltage}v`, `${specs.voltage} v`, `${specs.voltage} โวลต์`]);
  }
  return groups;
}

/** Natural part label for the existing shared no-match handoff template. */
export function buildChatProductSpecSubject(
  value: string | null | undefined,
  fallbackPartType?: string | null,
): string | null {
  const specs = resolveChatProductSpecs(value);
  if (specs.categoryHint !== COOLING_FAN_BLADE_CATEGORY_HINT) {
    return fallbackPartType?.trim() || null;
  }

  const details = [
    specs.fanDirection === "push"
      ? "แบบเป่า"
      : specs.fanDirection === "pull"
        ? "แบบดูด"
        : null,
    specs.diameterInches !== null ? `${formatSpecNumber(specs.diameterInches)} นิ้ว` : null,
    specs.voltage !== null ? `${specs.voltage}V` : null,
  ].filter(Boolean);
  return ["พัดลม", ...details].join(" ");
}
