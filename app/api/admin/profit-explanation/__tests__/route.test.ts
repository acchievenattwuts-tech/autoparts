import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

type HistoryInput = {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  keyRef: string | null;
};

const FILTERS = { from: "2026-09-01", to: "2026-09-23", basis: "ex_vat" as const };
let geminiReply: () => Promise<{ keyRef: string; text: string }>;
let pruneFails = false;
let dashboardComputations = 0;
const createdHistory: HistoryInput[] = [];
const listedFilters: unknown[] = [];
type RateLimitCall = { key: string; limit: number; windowMs: number };
const rateLimitCalls: RateLimitCall[] = [];
let rateLimitOk = true;
let geminiCalls = 0;

const evidence = {
  filters: FILTERS,
  selectedRange: {},
  previousRange: {},
  deltas: {},
  topPositiveDrivers: [],
  topNegativeDrivers: [],
  anomalies: [],
  evidenceLinks: [{ id: "summary:selected", label: "Selected", href: "/admin/dashboard" }],
};

before(async () => {
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1" } }) },
  });
  await mock.module("@/lib/profit-dashboard", {
    namedExports: {
      getProfitDashboardData: async () => {
        dashboardComputations += 1;
        return { filters: FILTERS };
      },
      resolveProfitDashboardFilters: (input: { from?: string; to?: string; basis?: string }) => ({
        from: input.from ?? "month-start",
        to: input.to ?? "today",
        basis: input.basis === "inc_vat" ? "inc_vat" : "ex_vat",
      }),
    },
  });
  await mock.module("@/lib/profit-explanation/evidence", {
    namedExports: { buildProfitExplanationEvidence: () => evidence },
  });
  await mock.module("@/lib/profit-explanation/history", {
    namedExports: {
      pruneExpiredProfitExplanationHistory: async () => {
        if (pruneFails) throw new Error("DB_DOWN");
        return 0;
      },
      listRecentProfitExplanationHistory: async (input: { filters: unknown }) => {
        listedFilters.push(input.filters);
        return [];
      },
      createProfitExplanationHistory: async (input: HistoryInput) => {
        createdHistory.push(input);
        return { id: "h1" };
      },
    },
  });
  await mock.module("@/lib/google-ai-client", {
    namedExports: {
      generateGeminiContent: async () => {
        geminiCalls += 1;
        return geminiReply();
      },
    },
  });
  await mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async (options: RateLimitCall) => {
        rateLimitCalls.push(options);
        return { ok: rateLimitOk, remaining: rateLimitOk ? 4 : 0, resetAt: Date.now() + 90_000 };
      },
    },
  });
});

beforeEach(() => {
  pruneFails = false;
  dashboardComputations = 0;
  createdHistory.length = 0;
  listedFilters.length = 0;
  rateLimitCalls.length = 0;
  rateLimitOk = true;
  geminiCalls = 0;
  geminiReply = async () => ({ keyRef: "key-1", text: JSON.stringify({ summary: "ok", confidence: "high" }) });
});

const post = async () => {
  const { POST } = await import("../route");
  const response = await POST(
    new Request("https://shop.test/api/admin/profit-explanation", { method: "POST", body: JSON.stringify(FILTERS) }),
  );
  return { status: response.status, body: (await response.json()) as { explanation?: { summary: string } } };
};

test("a used AI answer is recorded as SUCCESS", async () => {
  const result = await post();
  assert.equal(result.status, 200);
  assert.equal(result.body.explanation?.summary, "ok");
  assert.deepEqual(createdHistory[0], {
    ...createdHistory[0],
    status: "SUCCESS",
    errorCode: null,
    errorMessage: null,
    keyRef: "key-1",
  });
});

test("an AI answer that fails parsing is recorded as FAILED with the reason, same fallback shown", async () => {
  geminiReply = async () => ({ keyRef: "key-1", text: "not json at all" });
  const result = await post();
  assert.equal(result.status, 200);
  assert.match(result.body.explanation?.summary ?? "", /ไม่สามารถสรุป/);
  const [history] = createdHistory;
  assert.equal(history.status, "FAILED");
  assert.equal(history.errorCode, "AI_RESPONSE_REJECTED");
  assert.equal(history.errorMessage, "AI ส่ง JSON ไม่ถูกต้อง");
  assert.equal(history.keyRef, "key-1");
});

test("AI unavailable keeps the previous FAILED / AI_UNAVAILABLE_OR_FALLBACK record", async () => {
  geminiReply = async () => {
    throw new Error("NO_KEYS");
  };
  await post();
  const [history] = createdHistory;
  assert.equal(history.status, "FAILED");
  assert.equal(history.errorCode, "AI_UNAVAILABLE_OR_FALLBACK");
  assert.equal(history.errorMessage, null);
});

test("GET resolves filters without computing the dashboard and survives a failed prune", async () => {
  pruneFails = true;
  const { GET } = await import("../route");
  const response = await GET(
    new Request("https://shop.test/api/admin/profit-explanation?from=2026-09-01&to=2026-09-23&basis=inc_vat"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.equal(dashboardComputations, 0);
  assert.deepEqual(listedFilters, [{ from: "2026-09-01", to: "2026-09-23", basis: "inc_vat" }]);

  await GET(new Request("https://shop.test/api/admin/profit-explanation"));
  assert.deepEqual(listedFilters[1], { from: "month-start", to: "today", basis: "ex_vat" });
});

test("GET and POST reject malformed or impossible dates with 400 before any work", async () => {
  const { GET, POST } = await import("../route");
  const badQueries = ["from=abc", "to=2026-13-01", "from=2026-9-1", "from=20260901", "to=275760-01-01", "basis=gross"];
  for (const query of badQueries) {
    const response = await GET(new Request(`https://shop.test/api/admin/profit-explanation?${query}`));
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "PROFIT_EXPLANATION_INVALID_FILTERS" });
  }
  assert.equal(listedFilters.length, 0);

  const badBodies = [{ ...FILTERS, from: "yesterday" }, { ...FILTERS, to: 20260923 }, [FILTERS], null];
  for (const body of badBodies) {
    const response = await POST(
      new Request("https://shop.test/api/admin/profit-explanation", { method: "POST", body: JSON.stringify(body) }),
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(dashboardComputations, 0);
  assert.equal(createdHistory.length, 0);
});

test("filters the dashboard can send keep working exactly as before", async () => {
  const { GET, POST } = await import("../route");
  // Blank values fall back to the dashboard defaults; a reversed range is still
  // accepted because the dashboard's two date inputs allow picking one.
  await GET(new Request("https://shop.test/api/admin/profit-explanation?from=&to=%20&basis="));
  await GET(new Request("https://shop.test/api/admin/profit-explanation?from=2026-09-23&to=2026-09-01&basis=ex_vat"));
  await GET(new Request("https://shop.test/api/admin/profit-explanation?from=2015-01-01&to=2026-09-23&basis=inc_vat"));
  assert.deepEqual(listedFilters, [
    { from: "month-start", to: "today", basis: "ex_vat" },
    { from: "2026-09-23", to: "2026-09-01", basis: "ex_vat" },
    { from: "2015-01-01", to: "2026-09-23", basis: "inc_vat" },
  ]);

  const reversed = await POST(
    new Request("https://shop.test/api/admin/profit-explanation", {
      method: "POST",
      body: JSON.stringify({ from: "2026-09-23", to: "2026-09-01", basis: "ex_vat" }),
    }),
  );
  assert.equal(reversed.status, 200);
  const emptyBody = await POST(new Request("https://shop.test/api/admin/profit-explanation", { method: "POST" }));
  assert.equal(emptyBody.status, 200);
});

test("POST is rate limited per user (5 per 10 minutes) before the dashboard and Gemini run", async () => {
  const ok = await post();
  assert.equal(ok.status, 200);
  assert.deepEqual(rateLimitCalls, [{ key: "profit-explanation:u1", limit: 5, windowMs: 10 * 60_000 }]);

  rateLimitOk = false;
  dashboardComputations = 0;
  geminiCalls = 0;
  createdHistory.length = 0;
  const { POST } = await import("../route");
  const response = await POST(
    new Request("https://shop.test/api/admin/profit-explanation", { method: "POST", body: JSON.stringify(FILTERS) }),
  );
  assert.equal(response.status, 429);
  const retryAfter = Number(response.headers.get("Retry-After"));
  assert.ok(retryAfter >= 1 && retryAfter <= 90, String(retryAfter));
  assert.deepEqual(await response.json(), { error: "PROFIT_EXPLANATION_RATE_LIMITED", retryAfterSeconds: retryAfter });
  assert.equal(dashboardComputations, 0);
  assert.equal(geminiCalls, 0);
  assert.equal(createdHistory.length, 0);
});

test("GET history and invalid POST filters do not consume the rate limit", async () => {
  const { GET, POST } = await import("../route");
  await GET(new Request("https://shop.test/api/admin/profit-explanation?from=2026-09-01&to=2026-09-23"));
  await POST(
    new Request("https://shop.test/api/admin/profit-explanation", {
      method: "POST",
      body: JSON.stringify({ ...FILTERS, from: "yesterday" }),
    }),
  );
  assert.equal(rateLimitCalls.length, 0);
});
