import test from "node:test";
import assert from "node:assert/strict";

import {
  UNKNOWN_CLIENT_IP,
  getClientIp,
  getClientIpOrNull,
  parseForwardedFor,
} from "@/lib/client-ip";

const headersOf = (entries: Record<string, string | undefined>): Pick<Headers, "get"> => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

// Golden suite for rate-limit bucketing keys. Three call sites used to parse
// these headers by hand; these cases pin the behaviour they now share.

test("takes the first entry of an x-forwarded-for chain", () => {
  assert.equal(parseForwardedFor("203.0.113.7, 70.41.3.18, 150.172.238.178"), "203.0.113.7");
});

test("trims the surrounding whitespace Vercel leaves between entries", () => {
  assert.equal(parseForwardedFor("  203.0.113.7 , 70.41.3.18"), "203.0.113.7");
});

// A chain can start with an empty slot (", 70.41.3.18"). Returning "" there
// would hand the rate limiter a blank bucket key shared by every such caller.
test("skips empty leading entries instead of returning a blank key", () => {
  assert.equal(parseForwardedFor(", 70.41.3.18"), "70.41.3.18");
});

test("treats a missing or all-empty header as no address", () => {
  assert.equal(parseForwardedFor(null), null);
  assert.equal(parseForwardedFor(undefined), null);
  assert.equal(parseForwardedFor(""), null);
  assert.equal(parseForwardedFor(" , , "), null);
});

test("falls back to x-real-ip when there is no forwarded chain", () => {
  assert.equal(getClientIp(headersOf({ "x-real-ip": "198.51.100.9" })), "198.51.100.9");
});

test("prefers the forwarded chain over x-real-ip when both are present", () => {
  assert.equal(
    getClientIp(headersOf({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.9" })),
    "203.0.113.7",
  );
});

test("never returns an empty string when nothing identifies the caller", () => {
  assert.equal(getClientIp(headersOf({})), UNKNOWN_CLIENT_IP);
  assert.notEqual(getClientIp(headersOf({})), "");
});

// Login throttling adds an IP bucket only when it can attribute the request:
// lumping every unidentifiable attempt into one "unknown" bucket would let a
// handful of them lock out unrelated anonymous users.
test("the nullable variant reports no address rather than a placeholder", () => {
  assert.equal(getClientIpOrNull(headersOf({})), null);
  assert.equal(getClientIpOrNull(headersOf({ "x-real-ip": "   " })), null);
  assert.equal(getClientIpOrNull(headersOf({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});
