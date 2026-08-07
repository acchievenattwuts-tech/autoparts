import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCriticalErrorText,
  buildErrorSignature,
  normalizeErrorMessage,
  summarizeError,
} from "@/lib/error-reporting";

// Golden suite for critical-error alerting. The property that actually matters
// is grouping: the cooldown keys off the signature, so if the same bug produces
// a different signature per occurrence the shop gets flooded and stops reading
// the alerts — strictly worse than having none.

const at = new Date("2026-08-07T03:30:00+07:00");

// ── summarizeError ──────────────────────────────────────────────────────────

test("reads name and message off an Error", () => {
  assert.deepEqual(summarizeError(new TypeError("boom")), {
    name: "TypeError",
    message: "boom",
  });
});

// catch receives whatever was thrown; a reporter that throws on a string or a
// plain object would turn an incident into two incidents.
test("survives non-Error throws", () => {
  assert.deepEqual(summarizeError("plain string"), { name: "Error", message: "plain string" });
  assert.deepEqual(summarizeError({ weird: true }), { name: "UnknownError", message: "" });
  assert.deepEqual(summarizeError(null), { name: "UnknownError", message: "" });
  assert.deepEqual(summarizeError(undefined), { name: "UnknownError", message: "" });
});

test("caps a runaway message instead of sending it whole", () => {
  const summary = summarizeError(new Error("x".repeat(5_000)));
  assert.ok(summary.message.length <= 400);
});

// ── grouping ────────────────────────────────────────────────────────────────

test("strips uuids so the same bug on different records groups together", () => {
  assert.equal(
    normalizeErrorMessage("product 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found"),
    "product <id> not found",
  );
});

test("strips document numbers and bare numbers", () => {
  assert.equal(normalizeErrorMessage("SAC26050001 already cancelled"), "<docno> already cancelled");
  assert.equal(normalizeErrorMessage("row 1042 mismatch"), "row <n> mismatch");
});

test("strips timestamps", () => {
  assert.equal(
    normalizeErrorMessage("lock timeout at 2026-08-07T03:30:00.000Z"),
    "lock timeout at <time>",
  );
});

// The whole point: two failed sales are one alert, not two.
test("the same failure on two different documents shares one signature", () => {
  const a = buildErrorSignature("sales.create", new Error("stock too low for SAC26050001"));
  const b = buildErrorSignature("sales.create", new Error("stock too low for SAC26050002"));
  assert.equal(a, b);
});

test("different scopes stay separate even with an identical message", () => {
  const sale = buildErrorSignature("sales.create", new Error("lock timeout"));
  const purchase = buildErrorSignature("purchases.create", new Error("lock timeout"));
  assert.notEqual(sale, purchase);
});

test("different failures in the same scope stay separate", () => {
  const lock = buildErrorSignature("sales.create", new Error("lock timeout"));
  const stock = buildErrorSignature("sales.create", new Error("stock too low"));
  assert.notEqual(lock, stock);
});

// ── message ─────────────────────────────────────────────────────────────────

test("the alert names where it happened and what failed", () => {
  const text = buildCriticalErrorText({
    context: { scope: "sales.cancel", docNo: "SAC26050001", userId: "user_1" },
    error: new Error("lock timeout"),
    at,
  });
  assert.match(text, /sales\.cancel/);
  assert.match(text, /SAC26050001/);
  assert.match(text, /lock timeout/);
  assert.match(text, /2026/); // Gregorian year, not 2569
});

test("optional context lines are omitted rather than left blank", () => {
  const text = buildCriticalErrorText({
    context: { scope: "stock.recalculate" },
    error: new Error("boom"),
    at,
  });
  assert.doesNotMatch(text, /เลขที่เอกสาร/);
  assert.doesNotMatch(text, /รหัสอ้างอิง/);
  assert.doesNotMatch(text, /ผู้ใช้/);
  assert.match(text, /stock\.recalculate/);
});

test("an error with no message still produces a readable alert", () => {
  const text = buildCriticalErrorText({
    context: { scope: "cron.notifications" },
    error: new Error(""),
    at,
  });
  assert.match(text, /ไม่มีรายละเอียด/);
});

// lib/telegram.ts sends without a parse_mode, so nothing needs escaping — but
// that only holds while the text stays plain. A message full of markup must
// pass through untouched rather than be mangled or dropped.
test("markup characters in an error message pass through intact", () => {
  const text = buildCriticalErrorText({
    context: { scope: "products.update" },
    error: new Error("expected <Product> got *nothing* & _null_"),
    at,
  });
  assert.match(text, /expected <Product> got \*nothing\* & _null_/);
});

// The alert is a prompt to open the logs, not a place to dump a request body.
test("the alert carries only the identifiers it was given", () => {
  const text = buildCriticalErrorText({
    context: { scope: "sales.create", docNo: "SAC26050001", userId: "user_1" },
    error: new Error("failed"),
    at,
  });
  assert.doesNotMatch(text, /password|token|secret/i);
  assert.ok(text.length < 1_000);
});
