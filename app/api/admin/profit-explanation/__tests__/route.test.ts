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
    namedExports: { generateGeminiContent: async () => geminiReply() },
  });
});

beforeEach(() => {
  pruneFails = false;
  dashboardComputations = 0;
  createdHistory.length = 0;
  listedFilters.length = 0;
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
