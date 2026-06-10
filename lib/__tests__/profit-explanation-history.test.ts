import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("buildProfitExplanationFilterHash is stable across object key order", async () => {
  const { buildProfitExplanationFilterHash } = await import("@/lib/profit-explanation/history");

  assert.equal(
    buildProfitExplanationFilterHash({ from: "2026-06-01", to: "2026-06-10", basis: "ex_vat" }),
    buildProfitExplanationFilterHash({ basis: "ex_vat", to: "2026-06-10", from: "2026-06-01" }),
  );
});

test("buildProfitExplanationExpiresAt keeps records for sixty days", async () => {
  const { buildProfitExplanationExpiresAt } = await import("@/lib/profit-explanation/history");

  assert.equal(
    buildProfitExplanationExpiresAt(new Date("2026-06-10T00:00:00.000Z")).toISOString(),
    "2026-08-09T00:00:00.000Z",
  );
});
