import test from "node:test";
import assert from "node:assert/strict";

import { getLatestDeliveryProofTimes } from "../latest-delivery-proofs";

type Captured = { sql: string; values: unknown[] };

const fakeClient = (rows: unknown[], captured: Captured[]) => ({
  $queryRaw: ((strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ sql: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rows);
  }) as never,
});

test("returns [] without querying when there are no sales", async () => {
  const captured: Captured[] = [];
  const rows = await getLatestDeliveryProofTimes(fakeClient([], captured), []);
  assert.deepEqual(rows, []);
  assert.equal(captured.length, 0);
});

test("keeps the latest proof per sale in Postgres with the same order as the old distinct query", async () => {
  const captured: Captured[] = [];
  const capturedAt = new Date("2026-09-01T03:00:00.000Z");
  const rows = await getLatestDeliveryProofTimes(
    fakeClient([{ saleId: "s1", capturedAt }], captured),
    ["s1", "s2"],
  );

  assert.deepEqual(rows, [{ saleId: "s1", capturedAt }]);
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0].sql,
    'SELECT DISTINCT ON ("saleId") "saleId", "capturedAt" FROM "DeliveryProof" WHERE "saleId" = ANY(?::text[]) ORDER BY "saleId" ASC, "capturedAt" DESC',
  );
  // The whole id list is one array parameter, not 10,000 IN placeholders.
  assert.deepEqual(captured[0].values, [["s1", "s2"]]);
});
