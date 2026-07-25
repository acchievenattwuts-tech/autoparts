import type { ChatSearchIntent, ChatSubject } from "@/lib/chat-core/ai-service";

const THAI = {
  vigo: "วีโก้",
  coolingUnit: "ตู้แอร์",
  oil: "น้ำมัน",
  refrigerant: "น้ำยาแอร์",
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

export function extractPriceProductSubjectsFromText(text?: string | null): ChatSubject[] {
  const normalized = (text ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const subjects: ChatSubject[] = [];
  const hasVigo = /วีโก้|vigo/i.test(normalized);
  // The cooling-unit word must be CONTIGUOUS "ตู้แอร์"/"ตู้เย็น" (or the
  // evaporator colloquials) — never the bare "ตู้" inside "รถตู้" (a van!).
  // The old bare-"ตู้" alternative made a price turn that merely mentioned
  // "แผงแอร์รถตู้ commuter" extract a cooling-unit subject, which then overrode
  // the LLM classifier for the whole turn and answered with hanging cooling
  // units instead of condensers (production case 2026-07-25).
  const hasCoolingUnit = /(?<!รถ)ตู้\s*(?:แอร์|เย็น)|คอย(?:ล์|ล)?\s*เย็น|คลู\s*เกี/i.test(normalized);
  if (hasCoolingUnit) {
    subjects.push({
      partType: THAI.coolingUnit,
      carBrand: hasVigo ? "Toyota" : null,
      carModel: hasVigo ? "Vigo" : null,
      year: null,
      partKind: hasVigo ? "fitment" : "universal",
      query: hasVigo ? `${THAI.coolingUnit} Vigo` : THAI.coolingUnit,
    });
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

  return uniqueSubjects(subjects);
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
