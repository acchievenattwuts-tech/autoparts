import { normalizeSearchText } from "@/lib/search-normalization";
import { isCarYearRangeToken } from "@/lib/car-year-shorthand";

const REQUIRED_TOKEN_RE = /^[\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*$/u;

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
    if (REQUIRED_TOKEN_RE.test(cleaned)) tokens.add(cleaned);
  }
  return Array.from(tokens);
}
