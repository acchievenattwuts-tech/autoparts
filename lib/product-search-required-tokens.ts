import { normalizeSearchText } from "@/lib/search-normalization";
import { isCarYearRangeToken, isCarYearToken } from "@/lib/car-year-shorthand";

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

/**
 * Same shape as {@link extractProductSearchRequiredTokens}, but it also accepts
 * Thai combining marks — and its result is NEVER used as a search anchor.
 *
 * Why the split: `REQUIRED_TOKEN_RE` omits `\p{M}`, so any Thai word carrying a
 * vowel or tone mark glued to a digit fails it — `คอม508` passes while
 * `คอมแอร์508`, `พัดลม10`, `ซิตี้12`, `วีออส03` all fail. That is CORRECT for a
 * hard anchor (no product name literally contains "พัดลม10", so requiring it
 * would zero the search), but the LINE processor was also reading that same list
 * as "did this turn carry its own product detail?" — a question about the
 * CUSTOMER's message, not about the catalog.
 *
 * The consequence was a silent one: `latestHasProductSpecificity` stayed false
 * for glued Thai text, so the stale-vehicle guards never fired. Production
 * 2026-08-17 (conv cmq4ziq6l): "พัดลม10 24โว้นแผงคอยร้อน" typed right after a
 * D-Max question kept Isuzu/D-Max as a hard filter and returned 0 for a universal
 * fan that is in stock.
 *
 * Use this ONLY as a signal about the message. Never feed it to the search.
 */
const SPECIFICITY_TOKEN_RE = /^[\p{L}\p{M}\p{N}_-]*\d[\p{L}\p{M}\p{N}_-]*$/u;

/**
 * A number glued to a Thai counter is HOW MANY the customer wants, not what the
 * part is — "1อันคัฟ", "2ตัวครับ", "3ชิ้น". Reading an order quantity as product
 * detail would drop the vehicle the customer is buying FOR.
 */
const QUANTITY_TOKEN_RE = /\d+\s*(?:ตัว|ชิ้น|อัน|ใบ|ลูก|ชุด|กล่อง|เส้น|คู่)/u;

/** A long bare number is a phone number / account number, never a part spec. */
const LONG_BARE_NUMBER_RE = /^\d{7,}$/u;

export function extractProductSpecificityTokens(text?: string | null): string[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];

  const tokens = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    const cleaned = token.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
    if (cleaned.length < 3) continue;
    // A bare car year / year range / generation marker says something about the
    // VEHICLE, not about the part — mirroring the hard-anchor rules above so the
    // two stay conceptually aligned.
    if (isPlausibleCarYear(cleaned)) continue;
    // Also catches the "ปี"-prefixed forms customers glue on ("ปี13", "ปี2017").
    // Those describe the CAR, so counting them as part detail would drop a
    // vehicle the customer is still adding to.
    if (isCarYearToken(cleaned)) continue;
    if (isCarYearRangeToken(cleaned)) continue;
    if (GENERATION_MARKER_RE.test(cleaned)) continue;
    if (QUANTITY_TOKEN_RE.test(cleaned)) continue;
    if (LONG_BARE_NUMBER_RE.test(cleaned)) continue;
    if (SPECIFICITY_TOKEN_RE.test(cleaned)) tokens.add(cleaned);
  }
  return Array.from(tokens);
}
