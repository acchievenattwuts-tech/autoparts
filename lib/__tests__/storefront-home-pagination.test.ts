import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchHomeNewArrivalsPage,
  parseHomeNewArrivalsPage,
} from "@/lib/storefront-home-pagination";

test("accepts only bounded positive integer new-arrivals pages", () => {
  assert.equal(parseHomeNewArrivalsPage("1"), 1);
  assert.equal(parseHomeNewArrivalsPage("500"), 500);

  for (const value of [null, "", "0", "-1", "1.5", "501", "page-2"]) {
    assert.equal(parseHomeNewArrivalsPage(value), null, String(value));
  }
});

test("loads additional products through the GET route instead of a root Server Action", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const payload = {
    products: [{ id: "product-25" }],
    total: 48,
    page: 2,
    pageSize: 24,
  };

  const result = await fetchHomeNewArrivalsPage(2, async (input, init) => {
    calls.push({ input, init });
    return Response.json(payload);
  });

  assert.deepEqual(result, payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "/api/storefront/new-arrivals?page=2");
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].init?.cache, "no-store");
});

test("surfaces route failures so the UI can stop auto-loading and offer retry", async () => {
  await assert.rejects(
    fetchHomeNewArrivalsPage(2, async () => new Response(null, { status: 500 })),
    /status 500/,
  );
});

test("rejects malformed successful responses", async () => {
  await assert.rejects(
    fetchHomeNewArrivalsPage(2, async () => Response.json({ products: [] })),
    /Invalid new-arrivals response/,
  );
});
