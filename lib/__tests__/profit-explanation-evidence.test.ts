import test from "node:test";
import assert from "node:assert/strict";

import { ProfitSourceType } from "@/lib/generated/prisma";
import type { ProfitDashboardData } from "@/lib/profit-dashboard";

const emptySummary = {
  salesAmountExVat: 0,
  salesAmountIncVat: 0,
  costAmount: 0,
  expenseAmount: 0,
  grossProfit: 0,
  netProfitAmount: 0,
  marginPct: 0,
};

function buildData(): ProfitDashboardData {
  return {
    filters: { from: "2026-06-01", to: "2026-06-10", basis: "ex_vat" },
    today: emptySummary,
    yesterday: emptySummary,
    selectedRange: {
      salesAmountExVat: 120000,
      salesAmountIncVat: 128400,
      costAmount: 74000,
      expenseAmount: 9000,
      grossProfit: 46000,
      netProfitAmount: 37000,
      marginPct: 38.33,
    },
    previousRange: {
      salesAmountExVat: 100000,
      salesAmountIncVat: 107000,
      costAmount: 70000,
      expenseAmount: 6000,
      grossProfit: 30000,
      netProfitAmount: 24000,
      marginPct: 30,
    },
    trend: [],
    topProducts: [
      {
        productId: "p1",
        productCode: "AC-001",
        productName: "Compressor D-Max",
        quantity: 5,
        salesAmountExVat: 50000,
        salesAmountIncVat: 53500,
        costAmount: 30000,
        grossProfit: 20000,
        marginPct: 40,
        unitProfit: 4000,
      },
    ],
    lowProducts: [
      {
        productId: "p2",
        productCode: "EV-002",
        productName: "Expansion Valve",
        quantity: 3,
        salesAmountExVat: 3000,
        salesAmountIncVat: 3210,
        costAmount: 3600,
        grossProfit: -600,
        marginPct: -20,
        unitProfit: -200,
      },
    ],
    stockProducts: {
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      items: [],
    },
    customerAnalysis: {
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      items: [
        {
          customerId: "c1",
          customerName: "Garage A",
          invoiceCount: 4,
          quantity: 8,
          salesAmountExVat: 62000,
          salesAmountIncVat: 66340,
          costAmount: 39000,
          grossProfit: 23000,
          marginPct: 37.1,
        },
      ],
    },
    invoices: {
      pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      items: [
        {
          sourceId: "s1",
          sourceType: ProfitSourceType.SALE,
          sourceDocNo: "SL-001",
          businessDate: new Date("2026-06-03T00:00:00.000Z"),
          customerName: "Garage A",
          salesAmountExVat: 2500,
          salesAmountIncVat: 2675,
          costAmount: 2900,
          grossProfit: -400,
          marginPct: -16,
        },
      ],
    },
    alerts: [
      {
        severity: "high",
        kind: "loss",
        title: "Loss product",
        detail: "Gross profit below zero",
        productId: "p2",
        productCode: "EV-002",
        productName: "Expansion Valve",
        invoiceCount: 2,
      },
    ],
  };
}

test("buildProfitExplanationEvidence creates compact deltas and evidence refs", async () => {
  const { buildProfitExplanationEvidence } = await import("@/lib/profit-explanation/evidence");

  const evidence = buildProfitExplanationEvidence(buildData());

  assert.deepEqual(evidence.filters, { from: "2026-06-01", to: "2026-06-10", basis: "ex_vat" });
  assert.equal(evidence.deltas.netProfitAmount, 13000);
  assert.equal(evidence.deltas.grossProfit, 16000);
  assert.equal(evidence.topPositiveDrivers[0]?.evidenceRef, "product:p1");
  assert.equal(evidence.topNegativeDrivers[0]?.evidenceRef, "low-product:p2");
  assert.equal(evidence.anomalies[0]?.evidenceRef, "alert:loss:p2");
  assert.ok(evidence.evidenceLinks.some((link) => link.id === "invoice:s1"));
});

test("buildProfitExplanationEvidence limits noisy lists to top five", async () => {
  const { buildProfitExplanationEvidence } = await import("@/lib/profit-explanation/evidence");
  const data = buildData();
  data.topProducts = Array.from({ length: 8 }, (_, index) => ({
    ...data.topProducts[0],
    productId: `p${index}`,
    productName: `Product ${index}`,
    grossProfit: 1000 - index,
  }));

  const evidence = buildProfitExplanationEvidence(data);

  assert.equal(evidence.topPositiveDrivers.length, 5);
});
