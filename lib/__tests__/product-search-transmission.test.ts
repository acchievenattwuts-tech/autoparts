import test from "node:test";
import assert from "node:assert/strict";

// product-search.ts pulls in the db client at module load; give it a dummy URL
// (no query ever runs — the transmission helpers are pure).
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("detects manual (M/T) intent from a mixed Thai query", async () => {
  const { detectTransmissionIntent } = await import("@/lib/product-search");
  assert.equal(detectTransmissionIntent("หม้อน้ำ d-max 05 m/t"), "manual");
  assert.equal(detectTransmissionIntent("หม้อน้ำ vios เกียร์ธรรมดา"), "manual");
  assert.equal(detectTransmissionIntent("clutch manual"), "manual");
});

test("detects auto (A/T) intent from a mixed Thai query", async () => {
  const { detectTransmissionIntent } = await import("@/lib/product-search");
  assert.equal(detectTransmissionIntent("หม้อน้ำ d-max 05 a/t"), "auto");
  assert.equal(detectTransmissionIntent("หม้อน้ำ vios เกียร์ออโต้"), "auto");
  assert.equal(detectTransmissionIntent("กรองเกียร์อัตโนมัติ"), "auto");
});

test("returns null when no transmission is mentioned", async () => {
  const { detectTransmissionIntent } = await import("@/lib/product-search");
  assert.equal(detectTransmissionIntent("หม้อน้ำ d-max 05"), null);
  assert.equal(detectTransmissionIntent("ผ้าเบรค vios 2010"), null);
});

test("returns null when both transmissions are mentioned (ambiguous)", async () => {
  const { detectTransmissionIntent } = await import("@/lib/product-search");
  assert.equal(detectTransmissionIntent("หม้อน้ำ m/t a/t"), null);
});

test("does not false-positive on latin fragments inside other words", async () => {
  const { detectTransmissionIntent } = await import("@/lib/product-search");
  // "automatic-sounding" substrings embedded in unrelated words must not trigger.
  assert.equal(detectTransmissionIntent("matt black cover"), null);
  assert.equal(detectTransmissionIntent("status sensor"), null);
});

test("no intent produces a neutral (0) score fragment", async () => {
  const { buildTransmissionBoostExpr } = await import("@/lib/product-search");
  const expr = buildTransmissionBoostExpr(null);
  assert.equal(expr.sql.trim(), "0");
  assert.deepEqual(expr.values, []);
});

test("manual intent boosts manual products and penalizes auto products", async () => {
  const {
    buildTransmissionBoostExpr,
    MANUAL_PRODUCT_RE,
    AUTO_PRODUCT_RE,
    TRANSMISSION_MATCH_BOOST,
    TRANSMISSION_MISMATCH_PENALTY,
  } = await import("@/lib/product-search");

  const expr = buildTransmissionBoostExpr("manual");
  // Wanted (manual) regex must precede the opposite (auto) regex, and the
  // boost/penalty constants must be carried as bound parameters.
  const wantIdx = expr.values.indexOf(MANUAL_PRODUCT_RE);
  const oppIdx = expr.values.indexOf(AUTO_PRODUCT_RE);
  assert.ok(wantIdx >= 0 && oppIdx >= 0 && wantIdx < oppIdx);
  assert.ok(expr.values.includes(TRANSMISSION_MATCH_BOOST));
  assert.ok(expr.values.includes(TRANSMISSION_MISMATCH_PENALTY));
});

test("auto intent flips the wanted/opposite regex order", async () => {
  const { buildTransmissionBoostExpr, MANUAL_PRODUCT_RE, AUTO_PRODUCT_RE } =
    await import("@/lib/product-search");

  const expr = buildTransmissionBoostExpr("auto");
  const wantIdx = expr.values.indexOf(AUTO_PRODUCT_RE);
  const oppIdx = expr.values.indexOf(MANUAL_PRODUCT_RE);
  assert.ok(wantIdx >= 0 && oppIdx >= 0 && wantIdx < oppIdx);
});
