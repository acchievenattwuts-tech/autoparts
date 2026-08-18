/**
 * Parsing for colloquial car-year *ranges* that customers type in LINE chats,
 * e.g. "12-15" or "2012-2015" (meaning model years 2012 through 2015), and the
 * "ปี12-15" prefixed form. These are NOT part codes — but a bare token like
 * "12-15" carries a digit and reads like a model-code fragment, so without this
 * it (a) gets forced into the search as a hard required-token anchor that no
 * product name contains (zeroing the search) and (b) never becomes a real
 * fitment-year filter. Pure + dependency-free so it can be unit tested and reused
 * by both the required-token extractor and the search-year fallback.
 */

// Two-digit shorthand: "12" → 2012, "98" → 1998. Cars in this catalog span the
// late 1900s to near-future model years, so a low 2-digit number is 2000+, and a
// high one is 1900+. 40 is the split point (2040 vs 1941) — comfortably past the
// newest plausible model year while still reading "41".."99" as 1941..1999.
const TWO_DIGIT_CENTURY_SPLIT = 40;

// Plausible car model-year window. Matches the intent of isPlausibleCarYear in
// product-search-required-tokens.ts (1980–2035) but a touch wider on the low end
// so classic models still parse.
const MIN_CAR_YEAR = 1960;
const MAX_CAR_YEAR = 2035;

// Buddhist-era → Gregorian. Customers (and occasionally the LLM/OCR) give a car
// year in พ.ศ. (พ.ศ. = ค.ศ. + 543), but Product fitment years in the DB are
// Gregorian (ค.ศ.), so a B.E. year must be folded back before it's used as a
// search filter. A real ค.ศ. car year never reaches ~2200, while B.E. car years
// sit ~2493–2643, so anything ≥ 2200 is unambiguously B.E. (Values below 2200 —
// every plausible ค.ศ. car year — pass through untouched.)
const BUDDHIST_ERA_OFFSET = 543;
const BUDDHIST_ERA_MIN = 2200;
export const toGregorianCarYear = (year: number): number =>
  year >= BUDDHIST_ERA_MIN ? year - BUDDHIST_ERA_OFFSET : year;

const expandYear = (raw: string): number | null => {
  if (raw.length === 4) {
    const year = toGregorianCarYear(Number(raw));
    return year >= MIN_CAR_YEAR && year <= MAX_CAR_YEAR ? year : null;
  }
  if (raw.length === 2) {
    const yy = Number(raw);
    const year = yy <= TWO_DIGIT_CENTURY_SPLIT ? 2000 + yy : 1900 + yy;
    return year >= MIN_CAR_YEAR && year <= MAX_CAR_YEAR ? year : null;
  }
  return null;
};

// A year range: two 2- or 4-digit groups joined by a dash, optionally prefixed by
// the Thai word "ปี" (e.g. "ปี12-15"). Anchored so it only matches a whole token.
const YEAR_RANGE_TOKEN_RE = /^(?:ปี)?(\d{2}|\d{4})-(\d{2}|\d{4})$/u;

// A single car year, optionally prefixed by the Thai word "ปี" ("ปี13", "ปี2017",
// "2017"). Anchored so it only matches a whole token.
const YEAR_TOKEN_RE = /^(?:ปี)?(\d{2}|\d{4})$/u;

/**
 * True when the token is a single car-year shorthand. Mirrors
 * {@link isCarYearRangeToken} for the one-sided case, including the "ปี" prefix
 * customers routinely glue on — "ปี2017" describes the CAR, never the part, so
 * callers that ask "did this turn carry product detail?" must not count it.
 */
export const isCarYearToken = (token: string): boolean => {
  const match = token.match(YEAR_TOKEN_RE);
  if (!match) return false;
  return expandYear(match[1]) !== null;
};

/**
 * True when the token is a car-year *range* shorthand ("12-15", "2012-2015",
 * "ปี12-15") whose two ends are both plausible car years and non-descending.
 * Used to keep such a token out of the required-token (hard anchor) set.
 */
export const isCarYearRangeToken = (token: string): boolean => {
  const match = token.match(YEAR_RANGE_TOKEN_RE);
  if (!match) return false;
  const from = expandYear(match[1]);
  const to = expandYear(match[2]);
  return from !== null && to !== null && from <= to;
};

/**
 * Extracts the START year of a car-year range shorthand found anywhere in the
 * text, or null when none is present. The start year is used as the fitment-year
 * filter (the catalog stores a fitment year the range should cover). Returns the
 * first plausible range so "คอยเย็น Avanza 12-15" → 2012.
 */
export const parseCarYearRangeStart = (text?: string | null): number | null => {
  if (!text) return null;
  for (const rawToken of text.split(/\s+/)) {
    const token = rawToken.trim();
    if (!token) continue;
    const match = token.match(YEAR_RANGE_TOKEN_RE);
    if (!match) continue;
    const from = expandYear(match[1]);
    const to = expandYear(match[2]);
    if (from !== null && to !== null && from <= to) return from;
  }
  return null;
};
