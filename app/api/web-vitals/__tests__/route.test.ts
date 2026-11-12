import assert from "node:assert/strict";
import test, { afterEach, before, beforeEach, mock } from "node:test";

// F4 (2026-11-12): /api/web-vitals only writes a log line, so it now throttles in
// memory (no ApiThrottle write) and validates the payload before throttling. The
// `[web-vitals]` log line must stay byte-identical to the previous route.

let dbTouched = 0;
let rateLimitCalls = 0;
let POST: typeof import("../route").POST;
const infoLines: unknown[][] = [];

before(async () => {
  const touch = (): never => {
    dbTouched += 1;
    throw new Error("web-vitals must not touch the database");
  };
  mock.module("@/lib/db", {
    namedExports: { db: new Proxy({}, { get: touch }) },
  });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async (): Promise<never> => {
        rateLimitCalls += 1;
        throw new Error("web-vitals must not use the database rate limiter");
      },
    },
  });
  POST = (await import("../route")).POST;
});

beforeEach(() => {
  dbTouched = 0;
  rateLimitCalls = 0;
  infoLines.length = 0;
  mock.method(console, "info", (...args: unknown[]) => {
    infoLines.push(args);
  });
});

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

const validMetric = {
  id: "v5-1731400000000-1234567890",
  name: "LCP",
  value: 1834.5,
  delta: 1834.5,
  rating: "good",
  navigationType: "navigate",
  pathname: "/product/vios-compressor",
  href: "https://www.sriwanparts.com/product/vios-compressor?ref=fb",
  capturedAt: "2026-11-12T03:00:00.000Z",
  extra: "ignored",
};

const beacon = (ip: string, body: string): Request =>
  new Request("https://www.sriwanparts.com/api/web-vitals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body,
  });

/** The exact line the previous route printed for a valid metric. */
const previousLogLine = (payload: typeof validMetric): unknown[] => [
  "[web-vitals]",
  JSON.stringify({
    id: payload.id,
    name: payload.name,
    value: payload.value,
    delta: payload.delta,
    rating: payload.rating,
    navigationType: payload.navigationType,
    pathname: payload.pathname,
    href: payload.href,
    capturedAt: payload.capturedAt,
  }),
];

test("a valid metric is accepted and logs the same line as before, without the database", async () => {
  const response = await POST(beacon("49.228.10.1", JSON.stringify(validMetric)));

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(infoLines, [previousLogLine(validMetric)]);
  assert.equal(dbTouched, 0);
  assert.equal(rateLimitCalls, 0);
});

test("optional fields of the wrong type are logged as null exactly as before", async () => {
  const payload = { ...validMetric, rating: 3, navigationType: null, href: undefined, capturedAt: 0 };
  const response = await POST(beacon("49.228.10.2", JSON.stringify(payload)));

  assert.equal(response.status, 202);
  assert.deepEqual(infoLines, [
    [
      "[web-vitals]",
      JSON.stringify({
        id: validMetric.id,
        name: "LCP",
        value: 1834.5,
        delta: 1834.5,
        rating: null,
        navigationType: null,
        pathname: validMetric.pathname,
        href: null,
        capturedAt: null,
      }),
    ],
  ]);
});

test("malformed or unknown metrics are rejected with 400 and no log line", async () => {
  const bodies = [
    "not json",
    JSON.stringify({ ...validMetric, name: "XYZ" }),
    JSON.stringify({ ...validMetric, id: 12 }),
    JSON.stringify({ ...validMetric, pathname: "" }),
    JSON.stringify({ ...validMetric, value: "1" }),
    JSON.stringify({ ...validMetric, delta: null }),
  ];
  for (const body of bodies) {
    const response = await POST(beacon("49.228.10.3", body));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { ok: false });
  }
  assert.deepEqual(infoLines, []);
  assert.equal(dbTouched, 0);
});

test("the 61st valid beacon from one IP inside a minute gets 429 with Retry-After", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-12T03:00:00.000Z") });
  const ip = "49.228.10.4";
  for (let index = 0; index < 60; index += 1) {
    const response = await POST(beacon(ip, JSON.stringify(validMetric)));
    assert.equal(response.status, 202);
  }
  mock.timers.tick(15_000);
  const limited = await POST(beacon(ip, JSON.stringify(validMetric)));

  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "45");
  assert.deepEqual(await limited.json(), { ok: false });
  assert.equal(infoLines.length, 60);

  const otherIp = await POST(beacon("49.228.10.5", JSON.stringify(validMetric)));
  assert.equal(otherIp.status, 202);

  mock.timers.tick(45_000);
  const afterWindow = await POST(beacon(ip, JSON.stringify(validMetric)));
  assert.equal(afterWindow.status, 202);
  assert.equal(dbTouched, 0);
});

test("malformed posts do not use up the IP's budget", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-12T04:00:00.000Z") });
  const ip = "49.228.10.6";
  for (let index = 0; index < 100; index += 1) {
    await POST(beacon(ip, "{}"));
  }
  const response = await POST(beacon(ip, JSON.stringify(validMetric)));
  assert.equal(response.status, 202);
});
