export const COOLING_FAN_BLADE_CATEGORY_HINT = "Cooling Fan Blade";
export const BLOWER_MOTOR_CATEGORY_HINT = "Blower Motor)";
export const CONDENSER_FAN_MOTOR_CATEGORY_HINT = "Condenser Fan Motor";

export type ChatFanDirection = "push" | "pull";

export type ChatProductSpecs = {
  categoryHint: string | null;
  diameterInches: number | null;
  fanDirection: ChatFanDirection | null;
  voltage: number | null;
};

const BLOWER_CONTEXT_RE =
  /(?:โบล?เวอร์|blower|พัดลม\s*แอร์|พัดลม\s*(?:เป่า\s*)?ตู้แอร์|มอเตอร์\s*ตู้แอร์|พัดลม\s*เป่า\s*คอยล์เย็น)/iu;
const FAN_MOTOR_CONTEXT_RE =
  /(?:มอเตอร์\s*พัดลม|มอเตอร์\s*เป่า\s*แผง|พัดลม\s*หน้า(?:แผง|เครื่อง)|พัดลม\s*หม้อน้ำ|condenser\s+fan(?:\s+motor)?)/iu;
const FAN_BLADE_CONTEXT_RE = /(?:ใบ\s*พัดลม|ใบพัด|fan\s*blade)/iu;
const PUSH_FAN_RE = /(?:พัดลม\s*(?:แบบ\s*)?เป่า|แบบ\s*เป่า|push(?:er)?\s*fan|fan\s*push)/iu;
const PULL_FAN_RE = /(?:พัดลม\s*(?:แบบ\s*)?ดูด|แบบ\s*ดูด|pull(?:er)?\s*fan|fan\s*pull|suction\s*fan)/iu;
const FAN_CONTEXT_RE = /(?:พัดลม|ใบพัด|\bfan\b)/iu;

const extractDiameterInches = (text: string): number | null => {
  // Require an explicit inch unit. A bare number may be a model year, blade
  // count, product code, or voltage and must never become a size hard-filter.
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:นิ้ว|inches?|in\.?|")/iu);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 50 ? value : null;
};

const extractVoltage = (text: string): number | null => {
  const match = text.match(/(?:^|[^\d])(12|24)\s*(?:v(?:olt)?s?|โวลต์)/iu);
  return match?.[1] ? Number(match[1]) : null;
};

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
    voltage: extractVoltage(text),
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
