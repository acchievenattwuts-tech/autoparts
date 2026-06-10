import type { ProfitDashboardData, ProfitProductRow } from "@/lib/profit-dashboard";
import {
  PROFIT_EXPLANATION_MAX_ITEMS,
  type ProfitExplanationAnomaly,
  type ProfitExplanationDriver,
  type ProfitExplanationEvidence,
  type ProfitExplanationEvidenceLink,
} from "@/lib/profit-explanation/schema";

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function productHref(productId: string): string {
  return `/admin/products/${productId}/edit`;
}

function invoiceHref(sourceId: string): string {
  return `/admin/sales/${sourceId}`;
}

function productDriver(row: ProfitProductRow, prefix: string, impact: "positive" | "negative"): ProfitExplanationDriver {
  const evidenceRef = `${prefix}:${row.productId}`;

  return {
    title: row.productName,
    detail: `${row.productCode ? `${row.productCode} - ` : ""}qty ${row.quantity}, gross profit ${round(row.grossProfit)}, margin ${round(row.marginPct)}%`,
    impact,
    amount: round(row.grossProfit),
    marginPct: round(row.marginPct),
    evidenceRef,
  };
}

export function buildProfitExplanationEvidence(data: ProfitDashboardData): ProfitExplanationEvidence {
  const salesAmount =
    data.filters.basis === "inc_vat"
      ? data.selectedRange.salesAmountIncVat - data.previousRange.salesAmountIncVat
      : data.selectedRange.salesAmountExVat - data.previousRange.salesAmountExVat;

  const topPositiveDrivers = data.topProducts
    .slice()
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, PROFIT_EXPLANATION_MAX_ITEMS)
    .map((row) => productDriver(row, "product", "positive"));

  const topNegativeDrivers = data.lowProducts
    .slice()
    .sort((a, b) => a.grossProfit - b.grossProfit)
    .slice(0, PROFIT_EXPLANATION_MAX_ITEMS)
    .map((row) => productDriver(row, "low-product", "negative"));

  const anomalies: ProfitExplanationAnomaly[] = data.alerts
    .slice(0, PROFIT_EXPLANATION_MAX_ITEMS)
    .map((alert) => {
      const evidenceRef = `alert:${alert.kind}:${alert.productId ?? "unknown"}`;
      return {
        title: alert.title,
        detail: alert.detail,
        severity: alert.severity,
        evidenceRef,
      };
    });

  const evidenceLinks: ProfitExplanationEvidenceLink[] = [
    { id: "summary:selected", label: "Selected range summary", href: "/admin/dashboard?tab=profit" },
    { id: "summary:previous", label: "Previous range summary", href: "/admin/dashboard?tab=profit" },
    ...topPositiveDrivers.map((driver) => ({
      id: driver.evidenceRef,
      label: driver.title,
      href: productHref(driver.evidenceRef.replace("product:", "")),
    })),
    ...topNegativeDrivers.map((driver) => ({
      id: driver.evidenceRef,
      label: driver.title,
      href: productHref(driver.evidenceRef.replace("low-product:", "")),
    })),
    ...anomalies.map((anomaly) => ({
      id: anomaly.evidenceRef,
      label: anomaly.title,
    })),
    ...data.invoices.items.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((invoice) => ({
      id: `invoice:${invoice.sourceId}`,
      label: invoice.sourceDocNo,
      href: invoiceHref(invoice.sourceId),
    })),
  ];

  return {
    filters: data.filters,
    selectedRange: data.selectedRange,
    previousRange: data.previousRange,
    deltas: {
      salesAmount: round(salesAmount),
      costAmount: round(data.selectedRange.costAmount - data.previousRange.costAmount),
      expenseAmount: round(data.selectedRange.expenseAmount - data.previousRange.expenseAmount),
      grossProfit: round(data.selectedRange.grossProfit - data.previousRange.grossProfit),
      netProfitAmount: round(data.selectedRange.netProfitAmount - data.previousRange.netProfitAmount),
      marginPct: round(data.selectedRange.marginPct - data.previousRange.marginPct),
    },
    topPositiveDrivers,
    topNegativeDrivers,
    anomalies,
    evidenceLinks,
  };
}
