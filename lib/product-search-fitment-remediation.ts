import { normalizeSearchText } from "@/lib/search-normalization";

export type FitmentYearHint = {
  yearStart: number | null;
  yearEnd: number | null;
};

const YEAR_PATTERN = /\b(19\d{2}|20\d{2}|21\d{2}|2200)\b/g;

export const parseFitmentYearHint = (query: string): FitmentYearHint => {
  const normalized = normalizeSearchText(query);
  const years = Array.from(normalized.matchAll(YEAR_PATTERN))
    .map((match) => Number(match[1]))
    .filter((year) => Number.isInteger(year));

  if (years.length === 0) {
    return { yearStart: null, yearEnd: null };
  }

  const [first, second] = years;
  return {
    yearStart: first,
    yearEnd: second ?? first,
  };
};

export const validateFitmentYearRange = (
  yearStart: number | null,
  yearEnd: number | null,
): { success: true } | { success: false; error: string } => {
  for (const year of [yearStart, yearEnd]) {
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
      return { success: false, error: "Invalid year range" };
    }
  }

  if (yearStart !== null && yearEnd !== null && yearStart > yearEnd) {
    return { success: false, error: "Year start must be before year end" };
  }

  return { success: true };
};
