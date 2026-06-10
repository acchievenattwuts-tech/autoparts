import test from "node:test";
import assert from "node:assert/strict";

test("buildProfitExplanationPrompt contains read-only evidence-only JSON guardrails", async () => {
  const { buildProfitExplanationPrompt } = await import("@/lib/profit-explanation/prompt");

  const prompt = buildProfitExplanationPrompt({
    filters: { from: "2026-06-01", to: "2026-06-10", basis: "ex_vat" },
    selectedRange: {
      salesAmountExVat: 1,
      salesAmountIncVat: 1,
      costAmount: 0,
      expenseAmount: 0,
      grossProfit: 1,
      netProfitAmount: 1,
      marginPct: 100,
    },
    previousRange: {
      salesAmountExVat: 0,
      salesAmountIncVat: 0,
      costAmount: 0,
      expenseAmount: 0,
      grossProfit: 0,
      netProfitAmount: 0,
      marginPct: 0,
    },
    deltas: {
      salesAmount: 1,
      costAmount: 0,
      expenseAmount: 0,
      grossProfit: 1,
      netProfitAmount: 1,
      marginPct: 100,
    },
    topPositiveDrivers: [],
    topNegativeDrivers: [],
    anomalies: [],
    evidenceLinks: [{ id: "summary:selected", label: "Selected", href: "/admin/dashboard" }],
  });

  assert.match(prompt.systemInstruction, /read-only/i);
  assert.match(prompt.systemInstruction, /provided evidence JSON/i);
  assert.match(prompt.prompt, /Return only valid JSON/i);
  assert.match(prompt.prompt, /ควรตรวจต่อ/);
  assert.doesNotMatch(prompt.prompt, /GOOGLE_AI_API_KEY|AIza/);
});
