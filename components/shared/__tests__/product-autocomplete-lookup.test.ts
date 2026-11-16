import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  decideProductLookup,
  nextFocusSession,
  resolveProductLookupOnSubmit,
} from "../product-autocomplete-lookup";

// Golden scenarios for the admin product dropdown (2026-10-27). The owner chose
// fresh stock/price on every return to the field or to an earlier query; only
// true duplicates (already loading / already on screen) are skipped.

const SESSION = 3;

test("a new query fetches", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:Big",
      focusSession: SESSION,
      inFlightQuery: null,
      lastResult: { query: "admin:Bi", focusSession: SESSION },
    }),
    "fetch",
  );
});

test("a trailing space (same trimmed query) keeps the results already on screen", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:Big",
      focusSession: SESSION,
      inFlightQuery: null,
      lastResult: { query: "admin:Big", focusSession: SESSION },
    }),
    "keep-results",
  );
});

test("leaving the field does not re-request the list it was showing", () => {
  // Blur does not start a new focus session, so the mark still matches.
  const session = nextFocusSession(SESSION, true, false);
  assert.equal(session, SESSION);
  assert.equal(
    decideProductLookup({
      query: "admin:7122",
      focusSession: session,
      inFlightQuery: null,
      lastResult: { query: "admin:7122", focusSession: SESSION },
    }),
    "keep-results",
  );
});

test("coming back to the field fetches fresh stock and price", () => {
  const session = nextFocusSession(SESSION, false, true);
  assert.equal(session, SESSION + 1);
  assert.equal(
    decideProductLookup({
      query: "admin:7122",
      focusSession: session,
      inFlightQuery: null,
      lastResult: { query: "admin:7122", focusSession: SESSION },
    }),
    "fetch",
  );
});

test("typing back to an earlier query fetches it again (no reuse of old results)", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:Big",
      focusSession: SESSION,
      inFlightQuery: null,
      lastResult: { query: "admin:Big M", focusSession: SESSION },
    }),
    "fetch",
  );
});

test("a request already running for the same query is not started twice", () => {
  // Covers blur/focus while "7122" is still loading: production ran it twice
  // (15.2 s + 12.7 s) because the first request was aborted and re-sent.
  assert.equal(
    decideProductLookup({
      query: "admin:7122",
      focusSession: SESSION + 1,
      inFlightQuery: "admin:7122",
      lastResult: null,
    }),
    "keep-in-flight",
  );
});

test("a request running for a different query does not block the new one", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:Big M",
      focusSession: SESSION,
      inFlightQuery: "admin:Big",
      lastResult: null,
    }),
    "fetch",
  );
});

test("first render with a query from the URL still fetches (unchanged)", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:toyota",
      focusSession: 0,
      inFlightQuery: null,
      lastResult: null,
    }),
    "fetch",
  );
});

test("focus sessions only advance when focus is gained", () => {
  assert.equal(nextFocusSession(0, false, false), 0);
  assert.equal(nextFocusSession(0, false, true), 1);
  assert.equal(nextFocusSession(1, true, true), 1);
  assert.equal(nextFocusSession(1, true, false), 1);
});

// Submitting the search (2026-11-16). The results page runs the same heavy
// search, so the dropdown must not start one for the submitted query: on
// Supabase Free the pair overlapped and a statement passed the 8 s cap
// ("0069" on 14 Nov, "5/16" on 16 Nov).

test("a submitted query does not start a dropdown request (e.g. on blur)", () => {
  const { submitted, keepResults } = resolveProductLookupOnSubmit({
    query: "admin:5/16",
    focusSession: SESSION,
    lastResult: { query: "admin:5/", focusSession: SESSION },
  });
  assert.deepEqual(submitted, { query: "admin:5/16", focusSession: SESSION });
  // The list on screen is for "5/", not for the submitted text.
  assert.equal(keepResults, false);
  assert.equal(
    decideProductLookup({
      query: "admin:5/16",
      focusSession: nextFocusSession(SESSION, true, false),
      inFlightQuery: null,
      lastResult: null,
      submitted,
    }),
    "keep-submitted",
  );
});

test("submitting the query already on screen keeps its list", () => {
  const { keepResults } = resolveProductLookupOnSubmit({
    query: "admin:7122",
    focusSession: SESSION,
    lastResult: { query: "admin:7122", focusSession: SESSION },
  });
  assert.equal(keepResults, true);
});

test("typing a different query after a submit fetches as before", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:5/16 ทองแดง",
      focusSession: SESSION,
      inFlightQuery: null,
      lastResult: null,
      submitted: { query: "admin:5/16", focusSession: SESSION },
    }),
    "fetch",
  );
});

test("coming back to the field after a submit fetches fresh stock and price", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:5/16",
      focusSession: nextFocusSession(SESSION, false, true),
      inFlightQuery: null,
      lastResult: null,
      submitted: { query: "admin:5/16", focusSession: SESSION },
    }),
    "fetch",
  );
});

test("without a submit the decisions are unchanged", () => {
  assert.equal(
    decideProductLookup({
      query: "admin:Big",
      focusSession: SESSION,
      inFlightQuery: null,
      lastResult: null,
      submitted: null,
    }),
    "fetch",
  );
});

test("the dropdown drops its pending lookup when the search form is submitted", () => {
  // Wiring guard: the admin product filter submits through its form (no
  // onSubmit prop), so the component must listen on the form and clear the
  // debounce timer that has not fired yet.
  const source = readFileSync(
    path.join(process.cwd(), "components", "shared", "ProductAutocomplete.tsx"),
    "utf8",
  );
  const cancelStart = source.indexOf("const cancelProductLookupOnSubmit = useCallback(");
  assert.notEqual(cancelStart, -1);
  const cancelBody = source.slice(cancelStart, source.indexOf("[mode],", cancelStart));
  assert.match(cancelBody, /clearTimeout\(productTimerRef\.current\)/);
  assert.match(cancelBody, /productRequestRef\.current\.controller\.abort\(\)/);
  assert.match(source, /form\.addEventListener\("submit", handleFormSubmit\)/);
  assert.match(source, /if \(!keywordMode\) cancelProductLookupOnSubmit\(query\)/);
});
