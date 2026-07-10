import { normalizeSearchText } from "@/lib/search-normalization";
import { isCarYearRangeToken } from "@/lib/car-year-shorthand";

const REQUIRED_TOKEN_RE = /^[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*$/u;

// Car-generation markers ("gen3", "เจน3", "จีเอ็น8") are fitment hints — the
// customer's way of saying which model generation — NOT part/model codes. No
// active CarModel or Product code uses "gen" as an identifier (verified against
// production data 2026-07-07); "Gen1/Gen3" only ever appears as a generation
// descriptor inside product names/aliases. Anchoring them as a HARD required
// token would zero out models that encode the same generation via a year range
// instead (e.g. an Evaporator aliased "Vios13-19" has no literal "gen3"). Dropped
// from the hard anchor set — the token still stays in the query string for soft
// FTS ranking, so parts that DO spell out "Gen3" still rank higher.
const GENERATION_MARKER_RE = /^(?:gen|เจน|จีเอ็น)\d+$/u;

const isPlausibleCarYear = (token: string) => {
  if (!/^\d{4}$/.test(token)) return false;
  const year = Number(token);
  return year >= 1980 && year <= 2035;
};

/**
 * Tokens with 3+ chars and a digit are usually model codes / part fragments
 * (e.g. 709, 2070, STA-7065). Keep them as required recall anchors so broad
 * search fallbacks cannot drift to a popular but unrelated car model.
 */
export function extractProductSearchRequiredTokens(text?: string | null): string[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    const cleaned = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (cleaned.length < 3) continue;
    if (isPlausibleCarYear(cleaned)) continue;
    // Car-year ranges ("12-15", "2012-2015") are fitment hints, not part codes —
    // never let them become a hard required-token anchor (no product name
    // contains "12-15", which would zero the search).
    if (isCarYearRangeToken(cleaned)) continue;
    // Car-generation markers ("gen3", "เจน3") — fitment hints, not part codes.
    if (GENERATION_MARKER_RE.test(cleaned)) continue;
    if (REQUIRED_TOKEN_RE.test(cleaned)) tokens.add(cleaned);
  }
  return Array.from(tokens);
}

/**
 * Product-code fast-path must stay stricter than generic required-token extraction.
 * Pure numeric fragments like engine size / trim ("2500", "2800") are useful
 * recall anchors for normal search, but they are too ambiguous to override
 * category/fitment filters as an exact-code lookup.
 */
export function isDirectProductCodeToken(token?: string | null): boolean {
  const normalized = normalizeSearchText(token);
  if (!normalized) return false;
  return /[a-z]/.test(normalized) || normalized.includes("-");
}
