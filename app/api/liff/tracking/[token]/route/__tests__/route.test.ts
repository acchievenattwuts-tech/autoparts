import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// The route endpoint is public (token-only) and every call can hit the external
// OSRM servers, so it must be rate limited per IP before any DB/OSRM work.

const TOKEN = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
let allowed = true;
const rateKeys: string[] = [];
let saleLookups = 0;
let osrmCalls = 0;

before(async () => {
  await mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async ({ key }: { key: string }) => {
        rateKeys.push(key);
        return { ok: allowed, remaining: allowed ? 1 : 0, resetAt: Date.now() + 60_000 };
      },
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: {
          findUnique: async () => {
            saleLookups += 1;
            return {
              id: "s1",
              trackingExpiry: null,
              destLatitude: 13.7,
              destLongitude: 100.5,
              deliveryTracking: { latitude: 13.8, longitude: 100.6 },
            };
          },
        },
      },
    },
  });
  await mock.module("@/lib/delivery-tracking", {
    namedExports: {
      isTrackingExpired: () => false,
      fetchOsrmRouteWithFailover: async () => {
        osrmCalls += 1;
        return { coordinates: [[13.8, 100.6]], distanceMetres: 1000, durationSeconds: 120, provider: "osrm" };
      },
      estimateDeliveryRoute: () => ({ distanceMetres: 1000, durationSeconds: 120 }),
    },
  });
});

beforeEach(() => {
  allowed = true;
  rateKeys.length = 0;
  saleLookups = 0;
  osrmCalls = 0;
});

const callRoute = async (token = TOKEN) => {
  const { GET } = await import("../route");
  const response = await GET(
    new Request(`https://shop.test/api/liff/tracking/${token}/route`, {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    }),
    { params: Promise.resolve({ token }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("within the limit the route is resolved as before, bucketed per client IP", async () => {
  const result = await callRoute();
  assert.equal(result.status, 200);
  assert.equal(result.body.provider, "osrm");
  assert.deepEqual(rateKeys, ["liff-tracking-route:203.0.113.9"]);
  assert.equal(osrmCalls, 1);
});

test("over the limit answers 429 without touching the DB or OSRM", async () => {
  allowed = false;
  const result = await callRoute();
  assert.equal(result.status, 429);
  assert.equal(saleLookups, 0);
  assert.equal(osrmCalls, 0);
});

test("an invalid token is rejected before it can consume the rate-limit bucket", async () => {
  const result = await callRoute("not-a-uuid");
  assert.equal(result.status, 400);
  assert.deepEqual(rateKeys, []);
});
