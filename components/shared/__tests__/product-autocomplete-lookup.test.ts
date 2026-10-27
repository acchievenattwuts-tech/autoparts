import assert from "node:assert/strict";
import test from "node:test";

import {
  decideProductLookup,
  nextFocusSession,
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
