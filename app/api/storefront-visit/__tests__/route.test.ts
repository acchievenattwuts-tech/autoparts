import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Egress review 2026-10-05 (E4): visits from Meta's ad-review crawler (headless Chrome
// on Meta's network) are acknowledged but neither throttled nor counted.

let createManyCalls = 0;
let rateLimitKeys: string[] = [];
let POST: typeof import("../route").POST;

before(async () => {
  mock.module("@/lib/db", {
    namedExports: {
      db: {
        storefrontVisitDaily: {
          createMany: async (): Promise<{ count: number }> => {
            createManyCalls += 1;
            return { count: 1 };
          },
        },
      },
    },
  });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async ({ key }: { key: string }) => {
        rateLimitKeys.push(key);
        return { ok: true, remaining: 59, resetAt: Date.now() + 60_000 };
      },
    },
  });
  POST = (await import("../route")).POST;
});

beforeEach(() => {
  createManyCalls = 0;
  rateLimitKeys = [];
});

const visit = (ip: string): Request =>
  new Request("https://www.sriwanparts.com/api/storefront-visit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.sriwanparts.com",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ visitorKey: "b622e5f2-0f84-4c1a-9d3e-0a1b2c3d4e5f", pathname: "/product/vios-compressor" }),
  });

test("a customer visit is throttled by IP and recorded", async () => {
  const response = await POST(visit("49.228.10.20"));

  assert.equal(response.status, 202);
  assert.deepEqual(rateLimitKeys, ["storefront-visit:49.228.10.20"]);
  assert.equal(createManyCalls, 1);
});

test("a Meta crawler visit is acknowledged without a throttle row or a visit row", async () => {
  for (const ip of ["157.240.22.35", "2a03:2880:f12f:83:face:b00c:0:25de"]) {
    const response = await POST(visit(ip));
    assert.equal(response.status, 202, ip);
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.deepEqual(rateLimitKeys, []);
  assert.equal(createManyCalls, 0);
});

test("invalid payloads are still rejected before the network check", async () => {
  const response = await POST(
    new Request("https://www.sriwanparts.com/api/storefront-visit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "157.240.22.35" },
      body: JSON.stringify({ visitorKey: "short", pathname: "/admin/products" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(createManyCalls, 0);
});
