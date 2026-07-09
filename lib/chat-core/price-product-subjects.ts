import type { ChatSearchIntent, ChatSubject } from "@/lib/chat-core/ai-service";

const THAI = {
  vigo: "\u0e27\u0e35\u0e42\u0e01\u0e49",
  coolingUnit: "\u0e15\u0e39\u0e49\u0e41\u0e2d\u0e23\u0e4c",
  oil: "\u0e19\u0e49\u0e33\u0e21\u0e31\u0e19",
  refrigerant: "\u0e19\u0e49\u0e33\u0e22\u0e32\u0e41\u0e2d\u0e23\u0e4c",
};

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
  const hasVigo = /\u0e27\u0e35\u0e42\u0e01\u0e49|vigo/i.test(normalized);
  const hasCoolingUnit =
    /\u0e15\u0e39\u0e49\s*(?:\u0e41\u0e2d\u0e23\u0e4c)?|\u0e04\u0e2d\u0e22(?:\u0e25\u0e4c|\u0e25)?\s*\u0e40\u0e22\u0e47\u0e19|\u0e04\u0e25\u0e39\s*\u0e40\u0e01\u0e35/i.test(
      normalized,
    );
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
  const thaiWater = "\\u0e19\\u0e49(?:\\u0e33|\\u0e4d\\u0e32)";
  const hasWaterToken =
    new RegExp(thaiWater, "i").test(normalized) ||
    /เน€เธยเน€เธยเน€เธเธ“|เธเนเธณ/i.test(normalized);
  const hasOil =
    new RegExp(`${thaiWater}\\s*\\u0e21\\u0e31\\u0e19|${thaiWater}\\s*denso`, "i").test(normalized) ||
    /เธเนเธณ\s*เธกเธฑเธ|เธเนเธณ\s*denso/i.test(normalized);
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

  if (
    new RegExp(`${thaiWater}\\u0e22\\u0e32\\s*\\u0e41\\u0e2d\\u0e23\\u0e4c`, "i").test(normalized) ||
    new RegExp(`${thaiWater}\\u0e22\\u0e32`, "i").test(normalized) ||
    /เธเนเธณเธขเธฒ\s*เนเธญเธฃเน|เธเนเธณเธขเธฒ|เธเน.*เนเธญเธฃเน/i.test(normalized)
  ) {
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
