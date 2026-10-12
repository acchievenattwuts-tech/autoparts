import type { ChatSearchIntent, ChatSubject } from "@/lib/chat-core/ai-service";
import { scanCarYearMentions } from "@/lib/car-year-shorthand";
import { findCarBrandMentions } from "@/lib/chat-core/brand-variants";
import { findColloquialCarModelMentions } from "@/lib/chat-core/colloquial-car-model-aliases";
import { findCarKeywordMentions } from "@/lib/chat-core/fitment-extract";

const THAI = {
  coolingUnit: "ตู้แอร์",
  evaporator: "คอยล์เย็น",
  oil: "น้ำมัน",
  refrigerant: "น้ำยาแอร์",
};

/**
 * Why the rule refused to answer: the message names a car or year it cannot
 * read with certainty. The caller hands the turn to an admin instead of
 * searching, because guessing here is how the 2026-10-09 incident happened (an
 * All New D-Max coil answered with universal hanging units).
 */
export type PriceProductUnreadableReason = "UNREADABLE_VEHICLE" | "AMBIGUOUS_VEHICLE" | "AMBIGUOUS_YEAR";

export type PriceProductUnreadable = {
  reason: PriceProductUnreadableReason;
  /** The part the rule did recognise, for the hand-off acknowledgement. */
  partType: string;
  /** The customer's own words for the car, when the rule found any. */
  vehicleMention: string | null;
  year: number | null;
};

export type PriceProductTextAnalysis = {
  /** Subjects the rule fully understood. Always empty when `unreadable` is set. */
  subjects: ChatSubject[];
  unreadable: PriceProductUnreadable | null;
};

const NO_PRICE_SUBJECTS: PriceProductTextAnalysis = { subjects: [], unreadable: null };

// Latin words that are not cars: part brands, units, refrigerant/oil names and
// chat filler. Any OTHER Latin word next to a cooling part ("vios", "commuter",
// a part code) is treated as a car or code the rule cannot read.
const NON_VEHICLE_LATIN_WORDS = new Set([
  "denso", "stal", "valeo", "sanden", "marelli", "magneti", "kiki", "calsonic", "coolgear", "cool", "gear",
  "cc", "ml", "kg", "ac", "oil", "pag", "yf", "ok", "okay",
]);
const LATIN_WORD_RE = /[a-z]+/g;
const LATIN_SPELLING_RE = /^[a-z0-9]+$/;

type TextSpan = { start: number; end: number };

type PriceTurnFitment = {
  vehicle: { brandName: string; modelName: string; carModel: string } | null;
  year: number | null;
  unreadable: Omit<PriceProductUnreadable, "partType"> | null;
};

// "น้ำ" with either the single-glyph SARA AM (ำ) or the split NIKHAHIT + SARA AA
// (ํ + า) form some keyboards/IMEs produce.
const THAI_WATER_PATTERN = "น้(?:ำ|ํา)";

function uniqueSubjects(subjects: ChatSubject[]): ChatSubject[] {
  const seen = new Set<string>();
  const kept: ChatSubject[] = [];
  for (const subject of subjects) {
    const key = `${subject.partType ?? ""}|${subject.carBrand ?? ""}|${subject.carModel ?? ""}|${subject.year ?? ""}|${subject.query ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(subject);
  }
  return kept;
}

function blankSpans(text: string, spans: TextSpan[]): string {
  const chars = Array.from(text);
  // Spans are UTF-16 offsets; rebuild by offset so Thai combining marks stay put.
  let offset = 0;
  return chars
    .map((char) => {
      const start = offset;
      offset += char.length;
      return spans.some((span) => start >= span.start && start < span.end) ? " ".repeat(char.length) : char;
    })
    .join("");
}

function findSpellingSpans(text: string, spellings: string[]): TextSpan[] {
  const haystack = text.toLowerCase();
  const spans: TextSpan[] = [];
  for (const spelling of spellings) {
    const value = spelling.trim().toLowerCase();
    if (!value) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = LATIN_SPELLING_RE.test(value)
      ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g")
      : new RegExp(escaped, "gu");
    for (const match of haystack.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length });
    }
  }
  return spans;
}

/**
 * Reads the car and year next to a cooling part, or says it cannot. Only cars in
 * the colloquial alias table (plus their catalog names) are readable; any other
 * car word, another brand, two different cars, or an unclear year is
 * "unreadable" — the turn goes to an admin rather than to a search that ignores
 * the car.
 */
function readPriceTurnFitment(text: string): PriceTurnFitment {
  const consumed: TextSpan[] = [];

  const yearScan = scanCarYearMentions(text);
  consumed.push(...yearScan.years);
  const distinctYears = Array.from(new Set(yearScan.years.map((mention) => mention.year)));
  const yearUnclear = yearScan.ambiguous || distinctYears.length > 1;
  const year = !yearUnclear && distinctYears.length === 1 ? distinctYears[0] : null;

  const models = findColloquialCarModelMentions(text);
  const brands = findCarBrandMentions(text);
  let vehicle: PriceTurnFitment["vehicle"] = null;
  let vehicleReason: PriceProductUnreadableReason | null = null;
  let vehicleMention: string | null = null;

  const distinctModels = new Set(models.map((model) => `${model.brandName}|${model.modelName}`));
  if (distinctModels.size > 1) {
    vehicleReason = "AMBIGUOUS_VEHICLE";
    vehicleMention = models.map((model) => model.matchedText.trim()).join(" / ");
  } else if (models.length > 0) {
    const model = models[0];
    consumed.push(...models, ...findSpellingSpans(text, model.brandScopes));
    const foreignBrand = brands.find(
      (brand) =>
        brand.key !== model.brandName.toLowerCase() &&
        !consumed.some((span) => brand.start < span.end && span.start < brand.end),
    );
    if (foreignBrand) {
      // "toyota all new": the nickname belongs to another brand's model.
      vehicleReason = "UNREADABLE_VEHICLE";
      vehicleMention = `${foreignBrand.text} ${model.matchedText.trim()}`;
    } else {
      consumed.push(...brands);
      vehicle = {
        brandName: model.brandName,
        modelName: model.modelName,
        // A nickname stays in the customer's words so the evidence guard and the
        // shared alias resolver read it exactly like a classifier reply would; a
        // typed catalog name ("d-max") becomes the canonical model.
        carModel: model.viaCanonicalName ? model.modelName : model.matchedText.trim(),
      };
    }
  } else if (brands.length > 0) {
    // A brand with no model the table knows ("คอยเย็น isuzu").
    vehicleReason = "UNREADABLE_VEHICLE";
    vehicleMention = brands[0].text;
  }

  if (!vehicleReason) {
    const residual = blankSpans(text, consumed);
    const keyword = findCarKeywordMentions(residual)[0];
    const unknownLatinWord = (residual.toLowerCase().match(LATIN_WORD_RE) ?? []).find(
      (word) => word.length >= 2 && !NON_VEHICLE_LATIN_WORDS.has(word),
    );
    if (keyword) {
      vehicleReason = "UNREADABLE_VEHICLE";
      vehicleMention = keyword.text;
    } else if (unknownLatinWord) {
      vehicleReason = "UNREADABLE_VEHICLE";
      vehicleMention = unknownLatinWord;
    }
  }

  const reason = vehicleReason ?? (yearUnclear ? "AMBIGUOUS_YEAR" : null);
  if (reason) {
    // An unclear year with a readable car still names that car in the hand-off.
    const mention = vehicleMention ?? vehicle?.carModel ?? null;
    return { vehicle: null, year, unreadable: { reason, vehicleMention: mention, year } };
  }
  return { vehicle, year, unreadable: null };
}

function buildCoolingPartSubject(partType: string, fitment: PriceTurnFitment): ChatSubject {
  if (fitment.vehicle) {
    return {
      partType,
      carBrand: fitment.vehicle.brandName,
      carModel: fitment.vehicle.carModel,
      year: fitment.year,
      partKind: "fitment",
      query: [partType, fitment.vehicle.modelName, fitment.year].filter(Boolean).join(" "),
    };
  }
  if (partType === THAI.evaporator) {
    // A coil only fits a given car: keep it a fitment part so the search gate asks
    // for the car instead of listing every coil in the shop.
    return {
      partType,
      carBrand: null,
      carModel: null,
      year: fitment.year,
      partKind: "fitment",
      query: [partType, fitment.year].filter(Boolean).join(" "),
    };
  }
  // A bare ตู้แอร์ ask is the universal hanging unit, as before.
  return { partType, carBrand: null, carModel: null, year: null, partKind: "universal", query: partType };
}

/**
 * The deterministic price-turn reader. LINE uses it only when the Gemini
 * classifier gave no product subject; Messenger uses it for price-negotiation
 * turns. It must never answer for a car it cannot read — see
 * {@link PriceProductUnreadable}.
 */
export function analyzePriceProductText(text?: string | null): PriceProductTextAnalysis {
  const normalized = (text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return NO_PRICE_SUBJECTS;

  const subjects: ChatSubject[] = [];
  let unreadable: PriceProductUnreadable | null = null;
  // The cooling-unit word must be CONTIGUOUS "ตู้แอร์"/"ตู้เย็น" (or the
  // evaporator colloquials) — never the bare "ตู้" inside "รถตู้" (a van!).
  // The old bare-"ตู้" alternative made a price turn that merely mentioned
  // "แผงแอร์รถตู้ commuter" extract a cooling-unit subject, which then overrode
  // the LLM classifier for the whole turn and answered with hanging cooling
  // units instead of condensers (production case 2026-07-25).
  // It must also be the HEAD NOUN: a component-of-the-unit ask ("มอเตอร์ตู้แอร์",
  // "พัดลมตู้แอร์", "วาล์วคอยล์เย็น") or a cleaner ("ล้างคอยเย็น") names a
  // DIFFERENT product whose word merely embeds the unit — extracting the unit
  // would misroute the turn the same way "รถตู้" did.
  const hasCoolingUnit = /(?<!รถ|มอเตอร์|พัดลม|วาล์ว|แผง|สวิตช์|สวิทช์|ล้าง)ตู้\s*(?:แอร์|เย็น)|คลู\s*เกี/i.test(
    normalized,
  );
  // คอยล์เย็น is the evaporator coil itself — a part that fits one car, not the
  // universal hanging unit. It used to collapse into a universal ตู้แอร์ subject
  // with the car and year dropped, which answered "คอยล์เย็น all new ปี 2012"
  // with hanging units (production incident 2026-10-09). When both words appear
  // ("คอยล์เย็นตู้แอร์") the unit is the head noun, as before.
  const hasEvaporator =
    !hasCoolingUnit &&
    /(?<!มอเตอร์|พัดลม|วาล์ว|สวิตช์|สวิทช์|ล้าง)คอย(?:ล์|ล)?\s*เย็น/i.test(normalized);
  if (hasCoolingUnit || hasEvaporator) {
    const partType = hasCoolingUnit ? THAI.coolingUnit : THAI.evaporator;
    const fitment = readPriceTurnFitment(normalized);
    if (fitment.unreadable) {
      unreadable = { ...fitment.unreadable, partType };
    } else {
      subjects.push(buildCoolingPartSubject(partType, fitment));
    }
  }

  const hasDenso = /denso/i.test(normalized);
  const cc = normalized.match(/(\d{2,4})\s*cc/i)?.[1] ?? null;
  const hasWaterToken = new RegExp(THAI_WATER_PATTERN, "i").test(normalized);
  const hasOil = new RegExp(`${THAI_WATER_PATTERN}\\s*มัน|${THAI_WATER_PATTERN}\\s*denso`, "i").test(
    normalized,
  );
  if (hasOil || (hasDenso && cc !== null && hasWaterToken)) {
    subjects.push({
      partType: THAI.oil,
      carBrand: null,
      carModel: null,
      year: null,
      partKind: "universal",
      query: [THAI.oil, hasDenso ? "DENSO" : null, cc ? `${cc}cc` : null].filter(Boolean).join(" "),
    });
  }

  if (new RegExp(`${THAI_WATER_PATTERN}ยา\\s*แอร์|${THAI_WATER_PATTERN}ยา`, "i").test(normalized)) {
    subjects.push({
      partType: THAI.refrigerant,
      carBrand: null,
      carModel: null,
      year: null,
      partKind: "universal",
      query: THAI.refrigerant,
    });
  }

  if (unreadable) return { subjects: [], unreadable };
  return { subjects: uniqueSubjects(subjects), unreadable: null };
}

/** The subjects of {@link analyzePriceProductText}; empty when it refused to read the turn. */
export function extractPriceProductSubjectsFromText(text?: string | null): ChatSubject[] {
  return analyzePriceProductText(text).subjects;
}

export function buildPriceProductSearchIntent(subjects: ChatSubject[]): ChatSearchIntent | null {
  const kept = uniqueSubjects(subjects);
  const first = kept[0];
  if (!first) return null;
  return {
    group: "product",
    query: kept.map((subject) => subject.query || subject.partType).filter(Boolean).join(" "),
    isProductQuery: true,
    partType: first.partType,
    carBrand: first.carBrand,
    carModel: first.carModel,
    year: first.year,
    partKind: first.partKind,
    tooBroad: false,
    ...(kept.length >= 2 ? { subjects: kept } : {}),
  };
}
