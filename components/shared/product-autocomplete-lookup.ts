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
 *
 * Submitting the search (Enter / the search button) also ends the lookup for
 * that query: the results page runs the same heavy search, and on Supabase Free
 * the two overlapping pushed a statement past the 8 s cap (14 Nov 2026 "0069",
 * 16 Nov 2026 "5/16": page search + dropdown search started 0.1 s apart, 11–16 s
 * each). Until the query changes or the admin comes back to the field, a
 * submitted query does not start a dropdown request.
 */

/** Which query the dropdown is showing results for, and since which focus. */
export type ProductLookupResultMark = {
  query: string;
  focusSession: number;
};

export type ProductLookupDecision =
  | "fetch"
  | "keep-in-flight"
  | "keep-results"
  | "keep-submitted";

const matchesMark = (
  mark: ProductLookupResultMark | null | undefined,
  query: string,
  focusSession: number,
): boolean => Boolean(mark) && mark?.query === query && mark?.focusSession === focusSession;

export const decideProductLookup = ({
  query,
  focusSession,
  inFlightQuery,
  lastResult,
  submitted,
}: {
  query: string;
  focusSession: number;
  inFlightQuery: string | null;
  lastResult: ProductLookupResultMark | null;
  /** The query the admin last submitted to the results page, if any. */
  submitted?: ProductLookupResultMark | null;
}): ProductLookupDecision => {
  if (inFlightQuery === query) return "keep-in-flight";
  if (matchesMark(lastResult, query, focusSession)) return "keep-results";
  if (matchesMark(submitted, query, focusSession)) return "keep-submitted";
  return "fetch";
};

/**
 * What the dropdown keeps when the admin submits `query` to the results page.
 * `submitted` is the mark that stops a dropdown request for the same query;
 * `keepResults` is false when the list on screen belongs to another query, so
 * the field never re-opens a list that does not match its text.
 */
export const resolveProductLookupOnSubmit = ({
  query,
  focusSession,
  lastResult,
}: {
  query: string;
  focusSession: number;
  lastResult: ProductLookupResultMark | null;
}): { submitted: ProductLookupResultMark; keepResults: boolean } => ({
  submitted: { query, focusSession },
  keepResults: lastResult?.query === query,
});

/** A new focus session starts each time the field gains focus. */
export const nextFocusSession = (
  session: number,
  wasFocused: boolean,
  isFocused: boolean,
): number => (isFocused && !wasFocused ? session + 1 : session);
