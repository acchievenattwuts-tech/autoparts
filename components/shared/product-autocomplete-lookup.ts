/**
 * Admin product-card dropdown (ProductAutocomplete, product mode): decides
 * whether a debounced change needs a new search request.
 *
 * The dropdown used to re-request on every blur, every focus and every keystroke
 * that left the trimmed query unchanged (a trailing space). 229 of 545 production
 * requests on 24–26 Oct 2026 repeated a query within 60 s, and a duplicate that
 * started while the first was still running doubled the DB work ("7122":
 * 15.2 s + 12.7 s). The owner wants fresh stock and price whenever the admin
 * comes back to the field or to an earlier query, so only true duplicates are
 * skipped:
 *  - a request for this exact query is already running → let it finish;
 *  - this query's results already arrived during the current focus session
 *    (the field has not lost focus since) → they are what is on screen.
 * Anything else — a new query, an earlier query typed again, or the same query
 * after the field lost and regained focus — fetches again.
 */

/** Which query the dropdown is showing results for, and since which focus. */
export type ProductLookupResultMark = {
  query: string;
  focusSession: number;
};

export type ProductLookupDecision = "fetch" | "keep-in-flight" | "keep-results";

export const decideProductLookup = ({
  query,
  focusSession,
  inFlightQuery,
  lastResult,
}: {
  query: string;
  focusSession: number;
  inFlightQuery: string | null;
  lastResult: ProductLookupResultMark | null;
}): ProductLookupDecision => {
  if (inFlightQuery === query) return "keep-in-flight";
  if (lastResult && lastResult.query === query && lastResult.focusSession === focusSession) {
    return "keep-results";
  }
  return "fetch";
};

/** A new focus session starts each time the field gains focus. */
export const nextFocusSession = (
  session: number,
  wasFocused: boolean,
  isFocused: boolean,
): number => (isFocused && !wasFocused ? session + 1 : session);
