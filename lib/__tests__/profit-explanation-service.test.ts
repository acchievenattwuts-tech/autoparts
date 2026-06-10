import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const evidence = {
  filters: { from: "2026-06-01", to: "2026-06-10", basis: "ex_vat" as const },
  selectedRange: {
    salesAmountExVat: 100,
    salesAmountIncVat: 107,
    costAmount: 60,
    expenseAmount: 10,
    grossProfit: 40,
    netProfitAmount: 30,
    marginPct: 40,
  },
  previousRange: {
    salesAmountExVat: 90,
    salesAmountIncVat: 96.3,
    costAmount: 55,
    expenseAmount: 8,
    grossProfit: 35,
    netProfitAmount: 27,
    marginPct: 38.89,
  },
  deltas: {
    salesAmount: 10,
    costAmount: 5,
    expenseAmount: 2,
    grossProfit: 5,
    netProfitAmount: 3,
    marginPct: 1.11,
  },
  topPositiveDrivers: [],
  topNegativeDrivers: [],
  anomalies: [],
  evidenceLinks: [{ id: "summary:selected", label: "Selected", href: "/admin/dashboard" }],
};

test("parseProfitExplanationResult accepts valid JSON and drops unsupported refs", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult(
    JSON.stringify({
      summary: "กำไรเพิ่มขึ้นจากยอดขายและมาร์จินที่ดีขึ้น",
      confidence: "high",
      facts: [{ label: "Net Profit", value: "30", source: "system" }],
      drivers: [
        {
          title: "ยอดขายเพิ่ม",
          explanation: "อ้างอิงจากสรุปช่วงที่เลือก",
          impact: "positive",
          amount: 3,
          evidenceRefs: ["summary:selected", "missing"],
        },
      ],
      anomalies: [],
      recommendedChecks: [],
      limitations: [],
    }),
    evidence,
  );

  assert.equal(result.confidence, "high");
  assert.deepEqual(result.drivers[0]?.evidenceRefs, ["summary:selected"]);
});

test("parseProfitExplanationResult rejects mutation claims and returns fallback", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult(
    JSON.stringify({
      summary: "ระบบปรับราคาขายให้แล้ว",
      confidence: "high",
      facts: [],
      drivers: [],
      anomalies: [],
      recommendedChecks: [],
      limitations: [],
    }),
    evidence,
  );

  assert.equal(result.confidence, "low");
  assert.match(result.summary, /ไม่สามารถสรุป/);
});

test("parseProfitExplanationResult allows advisory checks about possible price changes", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult(
    JSON.stringify({
      summary: "ควรตรวจสอบว่ามีการปรับราคาหรือส่วนลดในช่วงนี้หรือไม่",
      confidence: "medium",
      facts: [],
      drivers: [
        {
          title: "Margin ลดลง",
          explanation: "ควรตรวจสอบการปรับราคา ส่วนลด หรือรายการขายที่ margin ต่ำ",
          impact: "negative",
          evidenceRefs: ["summary:selected"],
        },
      ],
      anomalies: [],
      recommendedChecks: [
        {
          label: "ตรวจสอบราคา",
          reason: "เป็นคำแนะนำเท่านั้น ไม่ได้บอกว่า AI แก้ไขข้อมูล",
        },
      ],
      limitations: [],
    }),
    evidence,
  );

  assert.equal(result.confidence, "medium");
  assert.equal(result.drivers[0]?.title, "Margin ลดลง");
});

test("parseProfitExplanationResult accepts markdown wrapped JSON", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult(
    [
      "```json",
      JSON.stringify({
        summary: "สรุปจาก JSON ที่ถูกห่อด้วย markdown",
        confidence: "medium",
        facts: [],
        drivers: [],
        anomalies: [],
        recommendedChecks: [],
        limitations: [],
      }),
      "```",
    ].join("\n"),
    evidence,
  );

  assert.equal(result.confidence, "medium");
  assert.equal(result.summary, "สรุปจาก JSON ที่ถูกห่อด้วย markdown");
});

test("parseProfitExplanationResult returns fallback for invalid JSON", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult("not json", evidence);

  assert.equal(result.confidence, "low");
  assert.match(result.limitations[0] ?? "", /JSON/);
});

test("parseProfitExplanationResult extracts JSON object from surrounding prose", async () => {
  const { parseProfitExplanationResult } = await import("@/lib/profit-explanation/service");

  const result = parseProfitExplanationResult(
    [
      "Here is the analysis:",
      JSON.stringify({
        summary: "Embedded JSON summary",
        confidence: "medium",
        facts: [],
        drivers: [],
        anomalies: [],
        recommendedChecks: [],
        limitations: [],
      }),
      "Hope this helps.",
    ].join("\n"),
    evidence,
  );

  assert.equal(result.confidence, "medium");
  assert.equal(result.summary, "Embedded JSON summary");
});
